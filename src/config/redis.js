const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD || '', // 从环境变量读取密码
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('error', (err) => console.error('Redis error:', err));
module.exports = redis;
