const express = require('express');
// 创建独立的路由实例，便于按模块拆分路由
const router = express.Router();
// 引入数据库查询（读写分离，写操作直接走此方法）
const { query } = require('../config/db');
// 引入缓存服务（读写缓存、防雪崩）
const cache = require('../services/cache');
// 引入布隆过滤器（防穿透）
const bloom = require('../services/bloom');
// 引入熔断器包装的查询方法（读操作走此方法，自动熔断降级）
const { executeQuery } = require('../services/breaker');

// 查询商品（四大压舱石串联）
// 完整链路：布隆过滤器(防穿透) → 缓存(防击穿) → 熔断器+读写分离(防雪崩/故障) → 写缓存(防雪崩)
router.get('/product/:id', async (req, res) => {
  const { id } = req.params; // 从 URL 路径中提取商品 ID
  const cacheKey = `product_${id}`; // 拼接缓存 key
  try {
    // 1. 布隆过滤器（防穿透）—— 判断 ID 是否可能存在
    // 返回 false 则一定不存在，直接拦截，不查缓存也不查数据库
    const maybeExists = await bloom.exists(id);
    if (!maybeExists) {
      return res.status(404).json({ code: 404, msg: '商品不存在(过滤)' });
    }
    // 2. 查缓存（防击穿）—— 缓存命中则直接返回，减轻数据库压力
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ code: 200, data: cached, source: 'cache' });
    }
    // 3. 熔断器 + 读写分离查从库
    // executeQuery 内部由熔断器包裹，数据库故障时自动降级返回
    // SELECT 语句由 db.js 自动路由到从库（slavePool）
    const sql = 'SELECT id, name, price, stock FROM products WHERE id = ?';
    const rows = await executeQuery(sql, [id]);
    // 数据库也查不到：说明是误判（布隆过滤器约 1% 误判率），返回 404
    if (!rows || rows.length === 0) {
      // 将该 ID 加入布隆过滤器，下次直接拦截（此处逻辑待商榷，详见说明）
      await bloom.add(id); // ← 这里有问题,对于确实不存在的 ID，应该用缓存空值（短 TTL）来防穿透
      return res.status(404).json({ code: 404, msg: '商品不存在' });
    }
    // 4. 写入缓存（随机TTL防雪崩）—— 缓存未命中时回写，TTL 带随机偏移防集中失效
    await cache.set(cacheKey, rows[0]);
    res.json({ code: 200, data: rows[0], source: 'db' });
  } catch (error) {
    // 熔断降级或其他异常：返回 503 服务不可用，避免抛出堆栈给前端
    console.error('查询失败:', error);
    res.status(503).json({ code: 503, msg: '服务降级，请稍后重试' });
  }
});

// 下单（写操作走主库）
// 写操作必须走主库保证数据一致性，写完后删除缓存避免脏读
router.post('/order', async (req, res) => {
  const { productId, quantity } = req.body; // 从请求体获取商品 ID 和购买数量
  try {
    // UPDATE 语句由 db.js 自动路由到主库（masterPool）执行
    const sql = 'UPDATE products SET stock = stock - ? WHERE id = ?';
    await query(sql, [quantity, productId]);
    // 缓存失效策略：删除旧缓存，下次查询时重新从数据库加载最新数据
    // 采用"删缓存"而非"更缓存"，避免并发更新导致的缓存与数据库不一致
    await cache.del(`product_${productId}`);
    res.json({ code: 200, msg: '下单成功' });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '下单失败' });
  }
});

// 登录（Session 存 Redis）
// 将用户信息写入 req.session，由 session 中间件自动同步到 Redis
// 多实例部署时所有实例共享 Redis 中的 Session，实现无状态登录
router.post('/login', (req, res) => {
  req.session.user = { id: 1, name: 'test_user' };
  res.json({ code: 200, msg: '登录成功，Session 存储在 Redis' });
});

// 获取用户信息（从 Redis Session 中读取）
// 无论请求落到哪个实例，都能通过 Redis 拿到登录态
router.get('/profile', (req, res) => {
  // 未登录：Session 中没有 user 信息，返回 401
  if (!req.session.user) return res.status(401).json({ msg: '未登录' });
  // 已登录：返回用户信息和当前 Session ID
  res.json({ code: 200, user: req.session.user, sessionId: req.sessionID });
});

module.exports = router;
