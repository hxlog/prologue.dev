---
title: 批判比特币和Web3
publishDate: 2022-07-25
lastmod: 2022-08-01
tags: ["Crypto", "Finance"]
description: 对web3的审美和投资疲劳也许才是后现代投资组合的常态。
---

## 比特币属性的悖论

### 货币

如果一个代币的价值非恒定，且和纳斯达克指数高度相关，且 beta 和标准差都大于基准(标普 500)。

在繁荣期间，大部分人都愿意持有它甚至想拥有更多，以至于没有人愿意使用它作为支付工具；在熊市，没有商家愿意接受长期贬值的货币，因为没有人愿意接受它，而萨尔瓦多总理反其道而行之，为刺激消费和旅游，将其设为法定货币，并购买比特币作为储备货币。

![BTC volatility 2013-2021](/static/images/BTC-Volatility-2013-2021.png)

尽管比特币在价格上呈现投机性，但它在货币的道路上已经失败了，并没有呈现低波动和平稳性。

Taleb 指出，黄金和其他贵金属作为存在的物理性质并不需要维护，而比特币网络需要长期的机器进行哈希运算验证区块且消耗算力和电量，这是“比特币存在”的维护费用；固有成本是矿机或显卡，变动成本为电费，如果比特币低于所有成本，同时矿工和主要持份者都不选择维护一定的价格，那么将没有人去挖矿，链上交易不再稳定和安全，这是一个纳什均衡。

Power of Work 机制的设定是指数增长的挖矿难度，这同时意味着对算力的要求加大，挖一定的比特币，而所需算力越大。

这种去中心化的矿工之间的非合约博弈仅仅解决了“拜占庭将军”的问题，一般拜占庭容错指的是不超过 1/3 的节点叛变的前提，但比特币仍然存在“51%算力攻击”技术上的可能性。

换而言之，比特币依赖于挖矿的永久性存在，可以推断比特币（目前 Proof of Work 制度）缺乏内在价值。

### 证券

比特币不创造价值，而持有代币也非权利和所有权。

代币经济中仅揭示比特币的流通和使用存在规模经济但非比特币的价值。

非股息资产存在价值变成 0 的可能性，$exp=0$，尽管存在其他大概率事件，例如价格保持在挖矿成本线之上，但这不应该存在数学预期之中，因为它依赖着矿工的参与，那贴现之后仍然是 0。

比特币的供应机制，大约每四年将挖矿奖励减少一半，很多人看作是稀缺的代表，这是**人为制造的稀缺**，像一些交易所代币会选择定期销毁和回购代币，以太坊合并后将进入通缩。

> 如果你说……为获得美国所有农田 1%的权益，支付我们 250 亿美元，我今天下午就给你写张支票。250 亿美元，我现在拥有 1%的农田。 如果你给我全国所有公寓的 1%，而你又想要 250 亿美元，我就给你写张支票，很简单。 如果你告诉我你拥有世界上所有的比特币你以 25 美元的价格卖给我，我不会接受，因为我会用它做什么？ 无论如何我都得把它卖回给你。 它不会做任何事情。 公寓用来产生租金，农场用来生产食物。

——沃伦·巴菲特

### 数字货币

存在一定的价格和投机需求，且满足互联网中价值的流通，能够储存有限的价值，另一种因网络流行文化或网络模因刺激而起的是 meme 币。

### 对冲通胀

先看下历史中黄金和白银的表现，在 1980 年通胀期间黄金和白银都大幅上涨但迅速回落，2008 和 2022 的通胀再次发现，但价格并没有回到 1980 年的水平。

![XAU and XAG price 1975-1985](/static/images/XAU-XAG-1975-1985-price.png)

一般来说，量化宽松的情况下导致流通的货币增加，而无处安放的货币只能寻求风险系数更高的资产，除了股票市场有大宗商品、贵金属和加密货币，他们只是在暂时存储价值，并不体现在内在价值上，所以价格往往很快呈现投机散场效应回落。

另一方面，黄金确实也不是一个可靠的通胀指标，它是布雷顿森林体系后美元的替代物，那比特币的情况显然不同，比特币大部分超过 90%的交易对是直接或间接与美元或美元稳定币交易对进行交易，且相关性和纳斯达克综合指数高度相关，它是美元的衍生货币；可以试想一下，合法监管的情况下，投资者卖掉比特币大概率也是会流入美元市场，不论如何，游戏规则是对美元强绑定的，所以它既是货币也是商品，考虑到比特币是不会付息的和矿工维护的性质，它不会是传统意义上的贵金属或证券，而在以太坊和其他公链上进行 ICO 则是有潜在证券的性质。

```r
# 11/18/2014 - 7/23/2022
total <- merge(data_btc,data_ndx,by=c("Date")) %>%
 rename(BTC = Close.x,NDX = Close.y) %>%
 mutate(lnBTC = log(BTC),lnNDX = log(NDX))

cor(total$BTC,total$NDX,method = "spearman")
```

```r
> [1] 0.9475907
```

```r
ggscatter(total, x = "lnNDX", y = "lnBTC",
          add = "reg.line", conf.int = TRUE,
          cor.coef = TRUE, cor.method = "spearman")
```

![Scatter plot lnBTC-lnNDX](/static/images/lnBTC-lnNDX.png)

相关性呈现统计显著，所以比特币是典型的风险资产。

## 跨链

区块链的不可能三角：安全性、去中心化、可拓展性。

就论 EVM 公链：Polygon、BSC、Avax-c、Heco、Celo、Harmony、Moonbeam......

对于大众而言，它们真的有明显的差异吗？难道用户选择钱包之前会看哪条公链的 tps 更高吗？他们关注的是哪条公链生态更好，有跨链桥、defi、预言机等基础设施,在 defi 和 nft 市场，layer2 的可拓展性应用在衍生品市场（例如 dydx 链下 orderbook 和匹配系统，链上交易）。

大部分公链都想着完成“一条公链就完成所有事情”这一目标，项目还没开始就已经在白皮书和经济模型中画大饼，难以想象在充满未知的行业却能写出如此准确的 Roadmap，因为路线大多是复制同行的，而那些声称“ETH 杀手”的公链大多都直接或间接和 EVM 兼容，因为它们意识到如果没有以太坊的引流和生态拓展，这些公链很可能失去其存在的价值，成为孤岛。

跨链最初是要解决公链之间的孤岛效应，Polkadot 使用 XCM 和 XCMP 通信协议在两条 Polkadot 平行链中搭建双向通道，这并不是真的通信协议，而是基于相对路径告诉目标应该做什么。

![Polkadot Structure](/static/images/Polkadot-Structure.png)

一般来讲跨链需要跨链桥，即一个协议在链 A 销毁原生币然后在链 B 生成该共识层的代币，这种跨链桥可能需要一定时间，考虑到网络状态、代币流通等因素。

Polkadot 的 XCM 协议则在区块链的设计上就同时完成了这一步骤。

代币转移`TransferAsset`

```rust
enum Instruction {
    TransferAsset {
        assets: MultiAssets,
        beneficiary: MultiLocation,
    }
    /* snip */
}
```

`MultiLocation`

- `Parachain(42)/AccountKey20(0x1234...abcd)`指定了平行链中的20-byte账户

- `../AccountId32(0x1234...cdef)`指定了同一平行链的32-byte账户

`MultiAsset`

```rust
struct MultiAsset {
   id: AssetId,
   fun: Fungibility,
}
```

```rust
enum AssetId {
   Concrete(MultiLocation),
   Abstract(BinaryBlob),
}
```

- `Abstract`允许`AssetId`作为名字
- `Concrete`的对象则是路径

```rust
enum Fungibility {
   Fungible(NonZeroAmount),
   NonFungible(AssetInstance),
}
```

![Polkadot XCM Teleport](/static/images/Polkadot-XCM-Teleport.png)

```rust
WithdrawAsset((Here, 10_000_000_000).into()),
InitiateTeleport {
    assets: All.into(),
    dest: Parachain(1000).into(),
    xcm: Xcm(vec![
        BuyExecution {
            fees: (Parent, 10_000_000_000).into(),
            weight: 3_000_000,
        },
        DepositAsset {
            assets: All.into(),
            max_assets: 1,
            beneficiary: Parent.into(),
        },
    ]),
}
```

如果想在第三条链上转移代币，但该代币暂时不支持该公链，那么需要在 Statemint 公链上完成储备（抵押形式），然后在 B 链生成新代币和在 A 链销毁原生币。

Statement 平行链，是 common good，免费的功能性公链，在 Kusama 是 Statemint。

![Polkadot XCM Reserve Based Transfer](/static/images/Polkadot-XCM-Reserve-Based-Transfer.png)

```rust
WithdrawAsset((Parent, 10_000_000_000).into()),
InitiateReserveWithdraw {
    assets: All.into(),
    dest: ParentThen(Parachain(1000)).into(),
    xcm: Xcm(vec![
        BuyExecution {
            fees: (Parent, 10_000_000_000).into(),
            weight: 3_000_000,
        },
        DepositReserveAsset {
            assets: All.into(),
            max_assets: 1,
            dest: ParentThen(Parachain(2001)).into(),
            xcm: Xcm(vec![
                BuyExecution {
                    fees: (Parent, 10_000_000_000).into(),
                    weight: 3_000_000,
                },
                DepositAsset {
                    assets: All.into(),
                    max_assets: 1,
                    beneficiary: ParentThen(Parachain(2000)).into(),
                },
            ]),
        },
    ]),
},
```

![Polkadot Architecture](/static/images/Polkadot-Architecture.png)

Cosmos 使用的是 PoS 机制，谁拥有的份额越多，提名权(vote_power)则越大，要成功提交一个区块就必须有超过 2/3 的验证者同意，就能正常出块，Cosmos 的共识层结合了 Pos 和 BFT（拜占庭容错），

Polkadot 使用的是 NPoS(Nominated Proof of Stake)，源于瑞典数学家 Lars Edvard Phragmén 提议的选举方法，这种方法能让席位分配和给他们的选票成比例，给与了当时瑞典的议员选举中少数族裔更多的代表权；通过质押 DOT 的份额比例作为参考，保证 1/n 的提名中至少有一个可信任的验证者。NPoS 在节点奖励上奉行平等主义，每个入选的可信任节点的奖励是相同的，促使持份者投给质押量更小的节点以获得更高回报。

NPoS 的目的是避免马太效应和寡头造成过度中心化的结果。

![Cosmos Hub](/static/images/Cosmos-Hub.svg)

Cosmos 的结构是中心辐射模型，它最大的亮点是 IBC 通信，在传输层，两个独立的区块链 A 和 B 通过 IBC 进行交互，它们有对应链的轻客户端。当 A 想与 B 交流某条信息'X'时，它向 B 发送存在该信息的区块头，以及该信息的承诺证明。承诺证明用于验证 A 上是否存在某条信息。

但是，A 和 B 并不直接在彼此之间发送这些消息/数据包。相反，当 A 希望向 B 发送消息时，它在其状态机中提交或存储包含该消息的数据包的哈希值。中继者，即链外进程，不断观察此类消息。当它们看到 A 在其状态机中提交了一个给 B 的消息时，它们会简单地接收这个消息并将其传递给 B。注意，中继者是无权限的，因此任何人都可以运行。

连接（Connections）负责连接两个不同链上的轻客户端。而通道是在这些不同链上的模块之间传输数据包的管道。因此，虽然连接是针对链的，但通道是针对模块的。每个通道端都有一个唯一的通道 ID（和一个端口 ID），用于在两个模块之间准确地路由数据包。

![Cosmos-SDK Structure](/static/images/Cosmos-SDK-Structure.svg)

在应用层，Interchain Standard 20 (ICS 20)规定了数据包的结构，它就像邮件传递系统，一个通用的信息传递，加上区块链、信道和轻节点，一套完整的模块化的区块链，只需要在 Cosmos SDK 上搭建，解决了公链之间孤岛效应。

跨链解决的是数字资产在不同公链的流动性问题，却仍然无法解决这些代币的用途。

## layer2

在 layer1，需要节点、区块网络、历史数据和共识层组成，layer2 解决了区块链的可扩展性问题，layer2 网络通过定期的交易捆绑，即 layer2 将大部分的工作量转移到另一条链，而这条链的安全性和流动性由 layer1 提供，而其中的锁定价值则是由 layer1 中的代币转移该链的存款账户，再由跨链桥确定并在 layer2 链上生成类似 xDAI 的代币。

|           | Zero Knowledge Validity Proofs | Interactive DepositSlash Fraud Proofs |
| --------- | ------------------------------ | ------------------------------------- |
| On chain  | zkRollups                      | Optimistic Rollups                    |
| Off chain | Validium                       | Plasma                                |

Validium:有效性证明，作为单笔提交到以太坊，计算在链下，最终打包提交给主链。没有提款延迟，需要很高的算力，案例 Starkware 将 zk-rollups 变成 SaaS 提供接口。

Plasma：通过 Merkle 树创造主链的堆栈，是独立的区块链且锚定 Ethereum 主网，但区块验证机制可以完全不同，维护子链和主链依赖欺诈证明，交易成批卷叠，以单笔交易提交至以太坊，只如果怀疑有欺诈行为，可以对它们提出质疑，对交易进行欺诈证明。

Validium 假设零信任，而 Plasma 假设全部人是可信任的。

## 批判 Web3

如果你没有“玩转 dapp”或“Solidity 开发”的经历，那么要理解 web3 是困难的，因为它的入口是一个“钱包”——公钥和地址，绝大部分玩家参与其中是为了 xx to earn 或 airdrop，本质上是**万物皆可兑现**，背后是**虚无**。

使用最简单的例子说明，Uniswap 的代币 Uni 代币仅仅是 Uniswap 的 DAO 治理权，即 Dapp 的政治，这种政治权力真的有价值吗？无数个 fork 版 uniswap，例如在 polygon 上的 quickswap，它也有其治理权代币 QUICK，但**影响其的价值是流动性和 TVL 价值**，而通过单一代币和治理权结合是不合理的，治理权难道不应该留给开发者和基金会吗，将代币空投给社区难道就完成了去中心化了吗？不，这是烂尾的开始，因为一切责任都将甩到持有这些代币的人身上；回到代币本身，UNI 不会作为手续费，因为它建立于多条公链上，gas 是区块链的原生代币，而非 dapp 代币，其次拥有 UNI 并不会让你更好的使用区块链，它的价值仅限于参与治理的权利，而权利的对立面却无义务。

DAO 并不是一种良性的治理方式，想想 the DAO 事件，BCH 算力战争，持份者会想尽办法分叉原生链吸干最后的价值，这就是人性。

凭空制造出来的代币它不一定有任何实际用途，defi 依赖的是背后的流动性支持，就算不发币也不会有本质变化。

我们必须明确区块链本身是一个账本，而去中心化的账本满足了 web3 对隐私、身份等的需求，但它的实际性能对不起 web。

web2 企业 google 依靠广告营销、流量来捕获价值，反过来问，web3 依赖什么捕获价值？是投机价值，“谁是最后的傻瓜”的游戏，它真的解决了 web2 的痛点吗？

这不是一个安全、隐私、去中心化的理想 web 社会，而是充斥着黑客攻击、犯罪交易的 Tor 2.0。

## 一些主观偏见

因以太坊的 gas price 的周期性，想以较低的 gas 进行交互还得看时辰，也不是说昂贵吧，swap 一次要\$10，我最贵给过$150 的 gas，如果因网络时间等因素导致延迟给少几块，是的，我不得不修改 nounce 双花取消，再重新支付一次费用。我听说过不少打算以区块链金融帮助贫困经济的蓝图，一年 365 天究竟有多少天的 swap 费用能低于贫困线的时薪？有人一定会说你用的是贵族链，怎么不到 BSC、layer2、野鸡链上搭建，我体验过 celo、avax 等公链，这些公链上的稳定币是 pegged，看下这次是 3AC 破产导致非超额质押的假币脱钩的案例还少吗，谈下 Terra 稳定币体系的脆弱性吗，这就是区块链风险的复杂程度，celo 停止出块的 issue，太多不可控的风险，这个金融体系就像是积木，它只能告诉你现在理论上是能用的，但它一旦出问题将是肥尾效应重现。

关于跨链桥，基于上述 gas 问题，所以跨链成本固然也一样高，但跨链的效率实在感人，受限于公链之间的网络拥堵，想通过质押生成 pegged token 进行双向通信本身也是个坑，只会给金融系统带来更多的复杂性和破坏力。

牛市即梦想，熊市即骗局，这就是对于币圈最好的写照，但我认为**拒绝使用代币通证的区块链，区块链提供的是服务，经济模型必须是可持续的**。

我已经受不了通过修改 ipfs 开源项目卖矿机卖代币却无实际用途的行为，就连一个 jpg 都无法保证它的持久性和可用性；也受不了通过 ICO 混淆证券和通证的行为，也受不了 forked evms 要给落后地区“扶贫”的行为。

但初于对区块链的热爱，我还是选择留下，开源社区还是非常有建设意义的，我也会拿空闲的机子做 pos 节点。

Augest 9, 2022补充：跑了一个某链的全节点，rust程序OOM，不开放http api以方便debug，就这代码质量上testnet。

Interchain Foundation. (2022, June 28). ELI5: What is IBC? - Cosmos Blog. Medium; Cosmos Blog. https://blog.cosmos.network/eli5-what-is-ibc-a212f518715f?gi=771014b38438

Taleb, N. N. (2021). Bitcoin, Currencies, and Fragility. ArXiv.org. https://doi.org/10.48550/arXiv.2106.14204

Wood, G. (2021, September 6). XCM: The Cross-Consensus Message Format. Polkadot Network; Polkadot Network. https://polkadot.network/blog/xcm-the-cross-consensus-message-format/

‌ 可能待补充：

- [ ] 通证经济
- [ ] 加密货币价值不恒等不等于没有价值，通缩机制的价值
- [ ] 人为制造的稀缺，货币文明
