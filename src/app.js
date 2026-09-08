const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const sessionMiddleware = require('./middleware/session');
const apiRoutes = require('./routes/api');

const app = express();
// 请求开始进入
app.use(helmet()); // 设置安全响应头（X-Frame-Options、CSP 等）
app.use(compression()); // 对响应体进行 Gzip 压缩
app.use(express.json()); // 解析请求体中的 JSON，挂到 req.body
app.use(sessionMiddleware); // 从 Redis 加载/保存 Session，挂到 req.session
app.use('/api', apiRoutes); // 业务路由处理
app.get('/health', (req, res) => res.send('OK')); // 健康检查 → 负载均衡探活
module.exports = app;

/**
有顺序，而且顺序非常重要。 Express 中间件严格按照 app.use() 的注册顺序依次执行，
每个中间件通过 next() 将控制权传递给下一个。
 */
