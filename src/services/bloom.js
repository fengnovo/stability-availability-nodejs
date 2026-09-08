// 引入 Redis 客户端（需开启 RedisBloom 模块，提供布隆过滤器命令）
const redis = require('../config/redis');
// 布隆过滤器在 Redis 中的 key 名称，用于存储商品 ID 的存在性标记
const BLOOM_KEY = 'bloom:products';
// （防穿透）—— 通过布隆过滤器拦截不存在的 ID，避免请求穿透到数据库

/**
 * 初始化布隆过滤器
 * 在应用启动时调用，创建一个带固定参数的布隆过滤器
 * 注意：BF.RESERVE 只能创建一次，重复创建会报错，因此需捕获"已存在"异常
 */
const initBloom = async () => {
  try {
    // 初始化布隆过滤器：设置误判率为1%，预期存储1000万个元素
    // 误判率越低、元素越多，占用内存越大；1% 误判率 + 1000万元素 约占 ~12MB 内存
    await redis.call('BF.RESERVE', BLOOM_KEY, '0.01', '10000000');
  } catch (e) {
    // 忽略"已存在"的错误（支持多种错误信息）—— 重复初始化是正常现象
    if (
      e.message &&
      (e.message.includes('already exists') ||
        e.message.includes('item exists'))
    ) {
      // 忽略：过滤器已存在，无需重复创建
    } else {
      // 其他异常（如 Redis 连接失败、RedisBloom 模块未加载等）需要打印日志
      console.error(e);
    }
  }
};

/**
 * 向布隆过滤器中添加一个商品 ID
 * 通常在商品创建/写入数据库时同步调用，保证过滤器与数据库数据一致
 * @param {string|number} id - 商品 ID
 */
const add = async (id) => {
  await redis.call('BF.ADD', BLOOM_KEY, id.toString());
};

/**
 * 判断商品 ID 是否可能存在
 * 核心防穿透逻辑：在查询缓存/数据库前先调用此方法
 * - 返回 false：ID 一定不存在，直接返回，避免穿透到数据库
 * - 返回 true：ID 可能存在（有约 1% 误判率），继续查询缓存和数据库
 * @param {string|number} id - 商品 ID
 * @returns {boolean} 是否可能存在
 */
const exists = async (id) => {
  const result = await redis.call('BF.EXISTS', BLOOM_KEY, id.toString());
  // BF.EXISTS 返回 1 表示可能存在，0 表示一定不存在
  return result === 1;
};

module.exports = { initBloom, add, exists };

/**
 bloom.js 是一个基于 Redis Bloom Filter（布隆过滤器） 的缓存穿透防护模块。
缓存穿透问题：当大量请求查询数据库中根本不存在的 ID（如恶意构造的 id=-1）时，
缓存永远命中不了，请求会直接打到数据库，导致数据库压力骤增甚至崩溃。

解决方案：在请求到达数据库前，先用布隆过滤器判断 ID 是否可能存在：
返回 false → 一定不存在，直接拦截，不查数据库 ✅
返回 true → 可能存在（有约 1% 误判率），再走缓存 → 数据库的正常流程
 */
