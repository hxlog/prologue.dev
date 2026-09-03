---
title: 使用Prophet时间序列预测比特币价格
tags: ["Quant", "Crypto", "Finance"]
image: /static/images/bitcoin-forecast-180-0.95.png
publishDate: 2023-08-15
description: 使用Prophet替代statsmodels的简单ARIMA，进行时间序列预测和交叉验证
---

## 序

没有任何物理、数学、统计学专业背景，从零开始的民间量化之路。

## 预测

第一次测试结果在交叉检验测试中 13.65%的 MAPE（平均绝对百分比误差）和 40%的覆盖率下，2024 年的 8 月 8 日，btc/usd 价格下限（80%的不确定宽度）是 12000？当然这是“潜在的最坏情况”。

![预测未来 365 日，不确定性区间宽度为 80%](/static/images/bitcoin-forecast.png)

从简单的参数选择来看，考虑到 1 年的覆盖误差（Coverage Error）过大，而且不追求精准度，只想覆盖现实的不确定性情况（95%）选择保守（一般来说覆盖率越接近不确定性宽度模型误差越小），模型设置 95%的不确定性区间。

```py
from prophet import Prophet


df_p = df.reset_index()[["date", "lnprice"]].rename(
    columns={"date": "ds", "lnprice": "y"}
)

model = Prophet(uncertainty_samples = 1000, mcmc_samples=0,seasonality_mode="multiplicative", interval_width= 0.95)
# multiplicative

# Fit the model
model.fit(df_p)

# create date to predict
future_dates = model.make_future_dataframe(periods=180)

# Make predictions
predictions = model.predict(future_dates)


model.plot(predictions)
model.plot_components(predictions)
```

![预测未来 180 日，不确定性区间宽度为 95%](/static/images/bitcoin-forecast-180-0.95.png)

目前 2023 年 8 月 14 日，btc/usd 是 29300，而模型显示目前严重高估，预测 2023 年 11 月 6 日的预测收盘价是 e^9.7122653758=16518.98，然后用 90/180 进行数据划分进行交叉验证。

```py
from prophet.diagnostics import cross_validation, performance_metrics

# 评估 180 天范围内的预测性能，从第一个截止点的 365.25 天训练数据开始，然后每 60 天进行一次预测

df_cv = cross_validation(model, initial='365.25 days', period='90 days', horizon = '180 days')

# Calculate evaluation metrics
res = performance_metrics(df_cv)

res
```

![MAPE平均绝对百分比误差](/static/images/bitcoin-forecast-test-error-mape.png)

![覆盖率验证](/static/images/bitcoin-forecast-test-error-coverage.png)

非常诱人的结果：MAPE 随着时间缓慢增长，到 180 天后仍然不超过 15%，覆盖率达到 70%，说明该模型适合被用作时间序列分析。

为何选择 MAPE 和 Coverage 来评估？

- 均方误差 (MSE)衡量预测值与实际值之间的平均平方差，**对异常值敏感**，比特币出现极端行情其实是很常见的。
- 均方根误差 (RMSE)是 MSE 的平方根，用于衡量预测值与实际值之间的平均距离，**问题是 RMSE 导致敏感度的下降**
- 平均绝对误差 (MAE)是预测值与实际值之间的平均绝对差，**关注误差的绝对大小**
- 平均绝对百分比（MAPE）误差计算预测值相对于实际值的百分比误差的平均值。衡量预测误差相对于实际值的大小，但实际值在极限到 0 或为 0 时出现极大的误差
- 覆盖率 (Coverage)评估置信区间的性能，覆盖率就是衡量这些置信区间是否能够包含实际值的比例

![比特币预测趋势](/static/images/bitcoin_forecast_trend.png)

<sup>季节性分析</sup>

对于周期性的结果是符合预期的，“黑色星期四”和“春节行情”。

$$
Y_t = T_t + S_t  + C_t + I_t
$$

$T_i$： 时趋势性项

$S_t$：t 时季节性项

$C_i$：t 时周期性项

$I_t$：无关（随机）项

选择乘性季节性，因为季节性周期的宽度或高度随着时间的推移而变化，尤其是在 2021 年 defi summer，btc 的周期性振幅超乎很多人的想象，但当时相当多的人仍然是线性思维判断。

为什么取对数仍然需要相乘模型？

![比特币预测的一些线性观点中，在长周期的分析中，简单的取对数分析是不够的](/static/images/tradingview-bitcoin-insight.png)

在 Tradingview 社区中会发现很多人认为在坐标系上取对数，然后再进行线性的技术分析就能解决非线性问题，特别是在长达两三年的周期性图表上，总是结果低估相对波动率和振幅。

$$
Y_t = T_t * S_t  * C_t * I_t
$$

其中三种不确定性来源：

- 趋势的不确定性
- 季节性估计的不确定性
- 额外的观测噪声

季节性和噪声在比特币价格运作中影响较少，主要是趋势的不确定性，趋势受到外界美元利率、通胀指数、纳斯达克指数、高风险股票收益率的影响，内部有矿工费、区块大小、地址增长速度，这里边必然存在多重共线性。

## 陷阱

![比特币价格取对数后的一次差分，呈现平稳性](/static/images/bitcoin-time-difference-of-lnclose-price.png)

为什么不能使用简单的 ARIMA 模型？

- 比特币呈现强周期和强季节性，还有强自相关性，如何在 ACF test 的图上可以明显看到没有出现指数式递减或迅速递减，尽管 residual 平稳以及价格本身 ADF test 验证平稳性，**ARIMA 可处理季节性但无法处理趋势和周期性**，对比特币进行简单 ARIMA 处理的结果是高误差和低敏感度，一条波动率降低的直线，因为它没有“过滤”掉“噪声”
- 非线性趋势，尽管对价格进行对数处理，但周期性幅度是可乘的（显著得肉眼观测历史数据可得）
- 异常值过度敏感

以后还会尝试进一步的模型选择和参数调优，尤其别是尝试 LSTM。
