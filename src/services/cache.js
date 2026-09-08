// 引入 Redis 客户端，作为缓存存储后端
const redis = require('../config/redis');
// 引入布隆过滤器模块，缓存预热时同步写入 ID 以防止缓存穿透
const bloom = require('./bloom');
// 缓存 key 的统一前缀，便于 Redis 中按前缀批量管理和区分命名空间
const CACHE_PREFIX = 'cache:';
// （防雪崩 + 预热）—— 通过随机 TTL 防雪崩，通过 warmup 预加载热点数据

/**
 * 读取缓存
 * @param {string} key - 缓存键（不含前缀）
 * @returns {object|null} 解析后的 JSON 对象，缓存不存在时返回 null
 */
const get = async (key) => {
  // 拼接完整 key 并从 Redis 读取，返回的是 JSON 字符串
  const data = await redis.get(`${CACHE_PREFIX}${key}`);
  // 有数据则反序列化为对象，无数据（缓存未命中）返回 null
  return data ? JSON.parse(data) : null;
};

/**
 * 写入缓存
 * @param {string} key - 缓存键（不含前缀）
 * @param {*} value - 要缓存的值（会被 JSON 序列化）
 * @param {number} baseTTL - 基础过期时间（秒），默认 300 秒
 * @returns {boolean} 写入成功返回 true
 */
const set = async (key, value, baseTTL = 300) => {
  // 防雪崩核心：在基础 TTL 上叠加 0~60 秒的随机偏移量
  // 避免大量 key 在同一时刻集中过期，导致请求瞬间全部穿透到数据库
  const randomOffset = Math.floor(Math.random() * 60);
  await redis.set(
    `${CACHE_PREFIX}${key}`,
    JSON.stringify(value), // 将对象序列化为字符串存储
    'EX', // EX = 以秒为单位设置过期时间
    baseTTL + randomOffset, // 实际 TTL = 基础值 + 随机偏移
  );
  return true;
};

/**
 * 删除缓存
 * 通常在数据库数据更新/删除时调用，保证缓存与数据库一致性
 * @param {string} key - 缓存键（不含前缀）
 */
const del = async (key) => {
  await redis.del(`${CACHE_PREFIX}${key}`);
};

/**
 * 缓存预热
 * 在服务启动时调用，将热点数据预先加载到缓存，降低冷启动阶段的数据库压力
 * 同时将 ID 写入布隆过滤器，防止这些 ID 被穿透查询
 * @param {Array<string|number>} keys - 需要预热的 ID 列表
 */
const warmup = async (keys) => {
  console.log('🔥 开始缓存预热...');
  for (const k of keys) {
    // 写入缓存：构造模拟商品数据，TTL 设为 600 秒（10 分钟）
    await set(k, { id: k, name: `Product_${k}`, warmup: true }, 600);
    // 同步将 ID 加入布隆过滤器，保证预热数据的存在性标记也建立好
    await bloom.add(k);
  }
  console.log('✅ 缓存预热完成');
};

module.exports = { get, set, del, warmup };
