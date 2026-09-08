// 引入 mysql2 的 Promise 版本，支持 async/await 异步操作数据库
const mysql = require('mysql2/promise');
// 加载 .env 环境变量配置（数据库地址、账号密码等）
require('dotenv').config();
// （读写分离核心）—— 写操作走主库，读操作走从库，提升数据库吞吐量

// ========== 主库连接池（负责写操作：增删改） ==========
const masterPool = mysql.createPool({
  host: process.env.DB_MASTER_HOST, // 主库地址
  port: process.env.DB_MASTER_PORT, // 主库端口
  user: process.env.DB_USER, // 数据库用户名
  password: process.env.DB_PASS, // 数据库密码
  database: process.env.DB_NAME, // 数据库名
  waitForConnections: true, // 连接池满时排队等待，而非直接报错
  connectionLimit: 20, // 主库最大连接数（写操作较少，连接数设小）
});

// 从库地址：未配置从库时回退到主库地址（兼容单库开发环境）单库降级
const slaveHost = process.env.DB_SLAVE_HOST || process.env.DB_MASTER_HOST;
//开发环境未配置从库时，从库连接池自动指向主库，保证代码无需修改即可在单库环境运行。

// ========== 从库连接池（负责读操作：查询） ==========
const slavePool = mysql.createPool({
  host: slaveHost,
  port: process.env.DB_SLAVE_PORT || process.env.DB_MASTER_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 50, // 从库最大连接数（读多写少，连接数设大）
});

/**
 * 统一的数据库查询入口，自动实现读写分离路由
 * @param {string} sql - SQL 语句
 * @param {Array} params - 预编译参数（防 SQL 注入）
 * @returns {Promise<Array>} 查询结果行
 */
const query = async (sql, params) => {
  // 通过 SQL 开头关键字判断是否为写操作（INSERT/UPDATE/DELETE/REPLACE/ALTER/CREATE/DROP）
  // i 修饰符表示大小写不敏感
  const isWrite = /^(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP)/i.test(
    sql.trim(),
  );
  // 写操作走主库，读操作走从库
  const pool = isWrite ? masterPool : slavePool;
  // execute 使用预编译语句，params 会被安全转义，防止 SQL 注入
  // 解构 [rows]：mysql2 返回 [rows, fields]，只取结果行
  const [rows] = await pool.execute(sql, params);
  return rows;
};

// 对外导出：统一查询方法 + 主从连接池（供事务等特殊场景直接使用）
module.exports = { query, masterPool, slavePool };

/**
 为什么用连接池？ 避免每次请求都新建数据库连接（TCP 握手 + 认证开销大），连接复用提升性能。
 waitForConnections: true 保证连接池打满时请求排队而非直接报错。
 */
