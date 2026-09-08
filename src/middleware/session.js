// 引入 express-session 中间件，用于管理用户会话（Session）
const session = require('express-session');
// 引入 connect-redis 适配器，将 Session 存储后端从默认内存切换为 Redis
// 传入 session 构造函数是 connect-redis v4+ 的固定用法
const RedisStore = require('connect-redis')(session);
// 引入统一的 Redis 客户端（与缓存、布隆过滤器共用同一个连接）
const redis = require('../config/redis');

// （无状态）—— Session 存 Redis 后，应用实例本身无状态，可水平扩展
module.exports = session({
  // 指定 Session 存储为 Redis，多实例共享同一份 Session 数据
  store: new RedisStore({ client: redis }),
  // 签名 Session ID 的密钥，优先使用环境变量；开发环境用兜底值（生产环境必须配置）
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  // false：仅在 Session 被修改时才写回 Redis，避免无意义的写入开销
  resave: false,
  // false：未初始化（未修改）的新 Session 不存储，节省 Redis 内存
  saveUninitialized: false,
  // Cookie 相关配置
  cookie: {
    // 生产环境下仅通过 HTTPS 传输 Cookie，防止中间人窃听
    secure: process.env.NODE_ENV === 'production',
    // 禁止浏览器 JS 通过 document.cookie 读取，防御 XSS 窃取 Session
    httpOnly: true,
    // Cookie 有效期：1 天（1000ms * 60s * 60min * 24h）
    maxAge: 1000 * 60 * 60 * 24,
  },
  // 自定义 Cookie 名称，避免使用默认的 connect.sid 暴露技术栈
  // session_id 是桥梁：客户端 Cookie 存 session_id，Redis 用 sess:session_id 存 session 数据
  name: 'session_id',
});

/**
session.js 配置了 Express 的 Session 中间件，核心目标是让应用服务器无状态化，
从而支持水平扩展。
为什么是"无状态"？
默认 MemoryStore（内存存储）：Session 存在单个进程内存中。多实例部署时，
用户的登录态只存在于某一台实例上，请求打到其他实例就会丢失登录态 → 无法扩容。
RedisStore（Redis 存储）：Session 统一存到 Redis，所有应用实例共享。
每个实例本身不保存任何状态，只负责处理请求 → 可随意扩容缩容。
*/
