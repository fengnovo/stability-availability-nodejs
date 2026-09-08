// 引入 opossum 熔断器库（Node.js 中成熟的熔断器实现，类似 Hystrix）
const CircuitBreaker = require('opossum');
// 引入底层数据库查询方法
const { query } = require('../config/db');

/**
 * 需要被熔断器保护的目标函数：执行数据库查询
 * 熔断器会包裹这个函数，统计其成功/失败率
 */
const dbQueryFunction = async (sql, params) => {
  return await query(sql, params);
};

// 创建熔断器实例，包裹数据库查询函数并配置各项阈值参数
const breaker = new CircuitBreaker(dbQueryFunction, {
  timeout: 3000, // 单次请求超时时间（ms），超过则视为失败并计入错误率
  errorThresholdPercentage: 50, // 错误率阈值（%），达到该比例时熔断器从「关闭」变为「打开」
  resetTimeout: 10000, // 熔断器「打开」后持续的时间（ms），之后进入「半开」状态
  rollingCountTimeout: 10000, // 滑动统计窗口时间（ms），在此窗口内统计请求成功率
  volumeThreshold: 5, // 最小请求量，窗口内请求数达到该值后才开始计算错误率
});

/**
 * 配置降级（fallback）函数
 * 当熔断器「打开」或请求失败/超时时，调用此函数返回降级结果，而不是抛出异常
 * 参数：原始调用参数 (sql, params) 以及错误对象 err
 */
breaker.fallback((sql, params, err) => {
  console.warn(`⚠️ 熔断降级触发: ${err?.message || '未知错误'}`);
  return { error: '系统繁忙，请稍后再试', fallback: true };
});

// 监听熔断器状态变化事件，便于运维观察
breaker.on('open', () => console.error('🚨 熔断器开启！')); // 打开：拒绝所有请求，直接走降级
breaker.on('halfOpen', () => console.log('🔄 熔断器半开，尝试恢复...')); // 半开：放行少量请求试探下游是否恢复
breaker.on('close', () => console.log('✅ 熔断器关闭')); // 关闭：恢复正常放行所有请求

/**
 * 对外暴露的数据库查询接口
 * 通过 breaker.fire 调用，由熔断器决定是真实执行查询还是返回降级结果
 */
const executeQuery = async (sql, params) => {
  return await breaker.fire(sql, params);
};

module.exports = { executeQuery, breaker };

/**
 这是一个基于 opossum 库实现的数据库查询熔断器（Circuit Breaker），
 属于高可用设计中的"熔断降级"模式。核心目的是：当数据库查询频繁失败或超时时，
 自动切断请求并返回降级结果，防止故障蔓延导致雪崩。
实现原理
熔断器有三种状态循环：
关闭（Closed）：正常放行所有请求
打开（Open）：错误率达阈值后，直接拒绝请求走降级
半开（Half-Open）：打开一段时间后，放行少量请求试探，成功则关闭，失败则继续打开
 */
