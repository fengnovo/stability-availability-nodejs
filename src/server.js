require('dotenv').config();
const app = require('./app');
const redis = require('./config/redis');
const { initBloom } = require('./services/bloom');
const { warmup } = require('./services/cache');

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await initBloom(); // 初始化布隆过滤器
    await warmup(['1', '2', '3']); // 缓存预热 + 自动加入布隆。实际业务会从数据库或日志或配置中取
    const server = app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
    // 监听终止信号（一般由 Docker、K8s 或进程管理器发送），执行优雅关闭
    process.on('SIGTERM', () => {
      // 先关闭 HTTP 服务器：停止接收新请求，等待已有请求处理完毕
      server.close(() => {
        // 断开 Redis 连接，释放资源
        redis.quit();
        // 正常退出进程（状态码 0 表示成功结束）
        process.exit(0);
      });
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
};
startServer();
