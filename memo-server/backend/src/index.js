const express = require('express');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' })); 

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET;

// SMTP 配置
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 465,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// --- 身份验证中间件 ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登录' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '登录失效，请重新登录' });
    req.user = user;
    next();
  });
};

// --- 接口 1: 发送验证码 ---
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '请输入邮箱' });

  try {
    // 频率检查: 60秒
    const lastCode = await pool.query(
      'SELECT created_at FROM auth_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [email]
    );

    if (lastCode.rows[0]) {
      const diff = (Date.now() - new Date(lastCode.rows[0].created_at).getTime()) / 1000;
      if (diff < 60) return res.status(429).json({ error: `请等待 ${Math.round(60 - diff)} 秒后再试` });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query(
      'INSERT INTO auth_codes (email, code, expire_at) VALUES ($1, $2, NOW() + interval \'5 min\')',
      [email, code]
    );

    await transporter.sendMail({
      from: `"随手记" <${process.env.SMTP_USER}>`,
      to: email,
      subject: '随手记登录验证码',
      text: `您的验证码是 ${code}，5分钟内有效。若非本人操作请忽略。`
    });

    res.json({ message: '验证码已发送' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '邮件发送失败' });
  }
});

// --- 接口 2: 登录/注册 ---
app.post('/api/auth/login', async (req, res) => {
  const { email, code } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM auth_codes WHERE email = $1 AND code = $2 AND expire_at > NOW()',
      [email, code]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: '验证码错误或已过期' });

    // 登录成功后删除该验证码
    await pool.query('DELETE FROM auth_codes WHERE email = $1', [email]);

    // 获取或创建用户
    let user = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      user = await pool.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
    }

    const token = jwt.sign({ userId: user.rows[0].id, email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: '登录失败' });
  }
});

// --- 接口 3: 保存笔记 ---
app.post('/api/notes', authenticateToken, async (req, res) => {
  const { content, source_url } = req.body;
  if (!content || content.length > 20000) return res.status(400).json({ error: '内容不能为空或超出2万字限制' });

  try {
    await pool.query(
      'INSERT INTO notes (user_id, content, source_url) VALUES ($1, $2, $3)',
      [req.user.userId, content, source_url]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '云端同步失败' });
  }
});

// --- 接口 4: 获取最近笔记 (Limit 10) ---
app.get('/api/notes', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, content, source_url, created_at FROM notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

// --- 接口 5: 删除笔记 ---
app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

app.listen(3000, () => console.log('Backend running on port 3000'));