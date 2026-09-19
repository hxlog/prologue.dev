-- =============================================================================
-- Seed the two collections that predate /studio: microblog and links.
--
-- These arrived from data/microblog.yaml and data/links.yaml, which are now
-- retired — the entries have lived in these tables since the import, and the
-- studio is how they are edited. This file is what a FRESH database gets, and
-- it is the only remaining record of the columns those two files held.
--
-- ## Why ON CONFLICT DO NOTHING, everywhere
--
-- On a database that already has these rows this migration must do NOTHING. A
-- seed that upserted would silently revert whatever the author had changed in
-- /studio since, once per deploy — and the failure would look like "my edit
-- disappeared", days later, with nothing in the logs. DO NOTHING makes the
-- migration idempotent AND non-destructive, which are different properties
-- and only the second one is about other people's data.
--
-- ## The anchors are not decoration
--
-- `mb-<yyyymmdd>-<n>` is a microblog entry's id on the page AND its guid in
-- /microblog/rss. The `n` came from the entry's INDEX in the YAML file, and
-- it cannot be recomputed: `nextAnchor()` in src/lib/studio/collections-write.js
-- numbers from the highest existing suffix, so a rebuilt collection would
-- produce different ids and re-notify every subscriber. Asserted by
-- scripts/db/smoke.mjs, which fails if any of the 26 guids moves.
-- =============================================================================

-- ── links ───────────────────────────────────────────────────────
INSERT INTO collections (slug, name, description, ordering, icon, public_read)
VALUES ('links', '友链', '朋友们的站点', 'manual', 'links', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO collection_fields (collection_id, key, label, type, required, sort_order)
SELECT id, 'name', '名称', 'text', true, 0
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, key) DO NOTHING;
INSERT INTO collection_fields (collection_id, key, label, type, required, sort_order)
SELECT id, 'description', '简介', 'long_text', false, 1
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, key) DO NOTHING;
INSERT INTO collection_fields (collection_id, key, label, type, required, sort_order)
SELECT id, 'blog_url', '链接', 'url', true, 2
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, key) DO NOTHING;
INSERT INTO collection_fields (collection_id, key, label, type, required, sort_order)
SELECT id, 'avatar', '头像', 'image', false, 3
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, key) DO NOTHING;

INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-0', 'published', '{"name":"Pathos Page","avatar":"/static/avatars/pathos.page.png","blog_url":"https://pathos.page/","description":"哲学片段与学术之路"}'::jsonb, 0,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-1', 'published', '{"name":"停云馆","avatar":"/static/avatars/blog.yizhou.ac.cn.png","blog_url":"https://blog.yizhou.ac.cn/","description":"博学之，审问之，慎思之，明辨之，笃行之"}'::jsonb, 1,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-2', 'published', '{"name":"理论派","avatar":"/static/avatars/sliun.com.png","blog_url":"https://sliun.com/","description":"谈谈史，说说道"}'::jsonb, 2,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-3', 'published', '{"name":"Unfinished","avatar":"/static/avatars/game-icons_dead-eye.svg","blog_url":"https://unfinished-wenai.vercel.app/","description":"一世风尘，也只如雪泥打他人脚底经过"}'::jsonb, 3,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-4', 'published', '{"name":"OrganWalk","avatar":"/static/avatars/organwalk.ink.ico","blog_url":"https://organwalk.ink/","description":"没有红色墨水的世界"}'::jsonb, 4,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-5', 'published', '{"name":"CC的数字花园","avatar":"/static/avatars/cyrus19.cc.png","blog_url":"https://cyrus19.cc/","description":"睡不着吗？"}'::jsonb, 5,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-6', 'published', '{"name":"滑翔闪","avatar":"/static/avatars/blog.huaxiangshan.com.ico","blog_url":"https://blog.huaxiangshan.com/","description":"正在学习经济学的二次元"}'::jsonb, 6,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-7', 'published', '{"name":"消解炼金术","avatar":"/static/avatars/melusinn.net.png","blog_url":"https://melusinn.net/","description":"没有月光照耀的日子，一切也都清晰得不见云雾"}'::jsonb, 7,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'link-8', 'published', '{"name":"Z.L Vansiit''s blog","avatar":"https://vansiit.cc/img/logo.svg","blog_url":"https://vansiit.cc/","description":"技术博客 | 生活随笔 | 唠嗑扯淡"}'::jsonb, 8,
       '2026-09-18T17:37:13.749Z'::timestamptz
  FROM collections WHERE slug = 'links'
ON CONFLICT (collection_id, anchor) DO NOTHING;

-- ── microblog ───────────────────────────────────────────────────
INSERT INTO collections (slug, name, description, ordering, icon, public_read)
VALUES ('microblog', '微博', '短想法与随拍', 'date', 'microblog', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO collection_fields (collection_id, key, label, type, required, sort_order)
SELECT id, 'content', '正文', 'long_text', true, 0
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, key) DO NOTHING;
INSERT INTO collection_fields (collection_id, key, label, type, required, sort_order)
SELECT id, 'date', '日期', 'date', true, 1
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, key) DO NOTHING;
INSERT INTO collection_fields (collection_id, key, label, type, required, sort_order)
SELECT id, 'images', '图片', 'image_gallery', false, 2
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, key) DO NOTHING;

INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20241231-0', 'published', '{"date":"2024-12-31","images":[],"content":"控制住自己的消费行为比获得消费满足更重要。"}'::jsonb, 0,
       '2024-12-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20241231-1', 'published', '{"date":"2024-12-31","images":[],"content":"尽管我过去因各种不可抗力的原因走了不少弯路，但重要的是我不会再犯同样的错，并善于反思。"}'::jsonb, 1,
       '2024-12-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20241231-2', 'published', '{"date":"2024-12-31","images":[],"content":"所谓教育是要让生命认可自身存在的价值，庆幸自己能够出生在这个世界。"}'::jsonb, 2,
       '2024-12-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250131-3', 'published', '{"date":"2025-01-31","images":[],"content":"长大后容易逐渐迷失自我，没有明确的目标，也没有稳定的身份认同，靠光怪陆离的消费文化引领着。看那些忙于奔命的人，他们是否知道自己在忙什么，为了到城里置业过上和父辈不一样的生活，问题是为什么要到城里呢？难道县城或大农村的生活就这么不值一提，以至于不惜重金也要过上“城里人的生活”。他们说的种种理由，在我看来无一是理性的。"}'::jsonb, 3,
       '2025-01-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250131-4', 'published', '{"date":"2025-01-31","images":[],"content":"尽管相比加沙、乌克兰我们显得过的非常安逸，但是在城市里的写字楼坐班何尝不也是一种违反人道主义的罪行？"}'::jsonb, 4,
       '2025-01-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250131-5', 'published', '{"date":"2025-01-31","images":[],"content":"所谓谷子经济，是一群人在消费“没有实质的文化”，娱乐至死不是一种政治学上奶头乐的概念，而是在美丽新世界中，每个人明知故犯，犬儒主义盛行，社会风气日渐世俗化，人们心甘情愿选择了消费型社会，并拒绝反思。"}'::jsonb, 5,
       '2025-01-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250131-6', 'published', '{"date":"2025-01-31","images":[],"content":"不论是买车还是买房，能带来的快乐最多不超过一到两个月，随之都是无穷无尽的烦恼。如果一个人活在当下就能快乐，那么是不需要获取外在认可就能自洽的一个人。如果是需要刻意获取什么才能获得快感，这样的快乐不过是过眼云烟。"}'::jsonb, 6,
       '2025-01-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250131-7', 'published', '{"date":"2025-01-31","images":[],"content":"最难受的莫过于看透了事物本质，却对自己的无动于衷而感到愧疚和罪恶。"}'::jsonb, 7,
       '2025-01-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250131-8', 'published', '{"date":"2025-01-31","images":[],"content":"一个人如果死了，那也会以另一种形式存在，只不过大部分人没有存在的必要。不过庆幸的是，恰好我还活着，仅此而已。所以我不应该赞美生命，而是将生命当成某种形式的绝唱。所谓生命的意义，是要在茫然虚无之中找到无法被祛魅的价值。"}'::jsonb, 8,
       '2025-01-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250131-9', 'published', '{"date":"2025-01-31","images":[],"content":"大部分人都只会对着政治事件说些漂亮话，却无动于衷。"}'::jsonb, 9,
       '2025-01-31T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250222-10', 'published', '{"date":"2025-02-22","images":[],"content":"盲目拜物的逻辑就是消费的意识形态。"}'::jsonb, 10,
       '2025-02-22T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250305-11', 'published', '{"date":"2025-03-05","images":[],"content":"我活得太过安逸，以至于活在和平年间都感到恶心，甚至想破坏这种死水一般的秩序。"}'::jsonb, 11,
       '2025-03-05T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250624-12', 'published', '{"date":"2025-06-24","images":[],"content":"最讨厌有人问我为什么喜欢评判社会却不去考公改变现状。首先，如果站在既得利益者的角度，任何批判的言论因其立场和利益关系就会丧失原有的动机和合理性，所有的批评都显得乏力。其次，是不想混在精致的利己主义者圈子内，玷污人的道德和尊严。很多人获得了权力，却抛弃了道德和常识，成为权力机构里死板地按规章制度行事的螺丝钉。最后，是它不值得被改善，而且不是所有人都有如此崇高的家国情怀。我相信在技术官僚系统下是不会有任何实质性改善，任何细小改变的举措都会被“回归”标准化，一种去人格化的社会工程建设，被层层KPI和形式主义奴役的政府只会是后极权主义的零部件，夺走了这片土地和人民原有的活力和潜力。如今仍然是一个被允许牺牲大部分利益的秩序，荒谬又合理。"}'::jsonb, 12,
       '2025-06-24T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250624-13', 'published', '{"date":"2025-06-24","images":[],"content":"活在现代社会，意味着生活是由商品物质基础、工作伦理、精神消费主义构成，大部分人穷极一生，追求的无非是房车、（可能是非自愿的）组建家庭。可怜的人民被国家资本主义和世俗价值观操纵，一会抱怨不明确的境外势力，一会抱怨政府和（红色）资本家，他们抱怨这么多，其实抱怨的终点是他们自己：自己为国企私企等制度既得利益者卖命被收割剩余价值，接受了民族主义的宣传，主动缴纳了原可避免的纳税项目。如果他们口中抱怨的任何事物是有错的，那么和自己脱不了关系，他们自己就沦为系统的一部分，同时也无法想象过另一种生活的可能，逐渐失去反抗的动机。毕竟这是为了生存啊，是无可奈何的，只能行尸走肉般活着，一天工作下来所剩无几的空闲时间，他们在刷短视频这一媒介景观，重塑人的感知偏好、社交网络和消费观念，人们开始忽视传统商品的内在价值，认可符号价值和差异化审美。我认为当下人们的敌人是他们自己的欲望，这应该推崇节欲、延迟满足还是道德选择呢，似乎都不太合适，而是应该活在真实中，消解宏大叙事和他者的欲望。我想，什么时候人们才能获得精神自由，这一天也许是临死前吧，这时任何努力都没有意义，祈求着死神早日结束掉这一场噩梦。"}'::jsonb, 13,
       '2025-06-24T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250624-14', 'published', '{"date":"2025-06-24","images":[],"content":"其实很多人组建家庭反而是搭建了一所监狱，长大后拥有了经济自由，却用各种物质基础建立新的围墙，美化父母的身份，把自己未完成的事强加给孩子。如果我以后有孩子，我一定会贯彻虚无主义的设定，不会要求他去做任何事物，也不需要成为一个所谓优秀的人，光是健康地活着已经是一种伟大。我们在反抗原生家庭的路上越走越远，如果是为了字面意义的生存，和祖先一样，一而再，再而三的延续家庭冷暴力和绩优主义，家庭只是一个看似和谐的牢笼。一个人如果被无知的原生家庭伤害，又用同样的教育方法应用到下一代，这样的人又和人渣有什么区别。"}'::jsonb, 14,
       '2025-06-24T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250624-15', 'published', '{"date":"2025-06-24","images":[],"content":"人生告一段落，大学毕业后的日子真是一日不如一日，主要是不自由的地活着。从活在别人的目光里，到拼命向别人去证明我的想法。尽管回头看做过很多错事，但是不做出改变和行动，就一定没有未来，那么只好选择一条最不留遗憾的路，主动选择并承担对应的责任和后果，这是我认为的自由。"}'::jsonb, 15,
       '2025-06-24T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250802-16', 'published', '{"date":"2025-08-02","images":[],"content":"正义不是制度的一部分，而是每个人每天都要重新决定的东西。"}'::jsonb, 16,
       '2025-08-02T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250830-17', 'published', '{"date":"2025-08-30","images":[],"content":"真正定义我们身份的，不是苦难本身，而是我们面对苦难的方式。"}'::jsonb, 17,
       '2025-08-30T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250830-18', 'published', '{"date":"2025-08-30","images":[],"content":"文化服务于人类逃避现实，人的天性害怕正视虚无，才需要找些事物沉迷进去。不论当初再伟大的作品，传播至今日，最终也被市场经济世俗化处理，直到变成每个人都能消费得起的消费文化，在这个过程中形成了文化资本和生活品味。如今我们称一个人有文化，也意味着他可能被困在权力规训的秩序中。"}'::jsonb, 18,
       '2025-08-30T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20250919-19', 'published', '{"date":"2025-09-19","images":[],"content":"我终于明白后现代情景下“无知即力量”的含义，是自以为有学识的人学到的都是权力机构提供的四书五经，当权者无法用语言和叙事PUA那些没有文化的人，这是无权者的权力。"}'::jsonb, 19,
       '2025-09-19T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20251012-20', 'published', '{"date":"2025-10-12","images":[],"content":"只有能够保持一种持久的独立的看法的人，才能真正信仰——这种信仰是作为一种灵魂的状态，作为一种“面对存在”而不是对来自外部某种东西盲目的认同。"}'::jsonb, 20,
       '2025-10-12T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20251012-21', 'published', '{"date":"2025-10-12","images":[],"content":"没有真正拥有过青春，那也没必要幻想对青春的认识和感受，当下的自己正写下青春的序章，不做出行动，站在原地思考，所有的怀念都是悲剧。"}'::jsonb, 21,
       '2025-10-12T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20251229-22', 'published', '{"date":"2025-12-29","images":[],"content":"从小就是“年年都是关键的一年”，到上大学后为了各种Title各种卷，权衡各种机会成本，到头来还不是沦为国家资本主义下的螺丝钉，什么都无法舍弃的人，什么都改变不了。"}'::jsonb, 22,
       '2025-12-29T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20260314-23', 'published', '{"date":"2026-03-14","images":[],"content":"在这遍布偶然成功和普遍平庸的世界里，唯一的自由就是面对世界时的自我姿态。"}'::jsonb, 23,
       '2026-03-14T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20260905-24', 'published', '{"date":"2026-09-05","images":[],"content":"真正的牛市顶部并不是大家都在怀疑某件事物，而是对某种发展方向或上涨深信不疑，没有任何反对的声音。"}'::jsonb, 24,
       '2026-09-05T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;
INSERT INTO collection_entries
  (collection_id, anchor, status, values, sort_order, published_at)
SELECT id, 'mb-20260905-25', 'published', '{"date":"2026-09-05","images":[],"content":"如果把当下要做的琐事和所谓的主线任务都完成就会获得自由时间，是不自由的代偿幻想。越是寄希望于未来的彻底解脱，就越会在当下的无休止异化中失去自由。"}'::jsonb, 25,
       '2026-09-05T00:00:00.000Z'::timestamptz
  FROM collections WHERE slug = 'microblog'
ON CONFLICT (collection_id, anchor) DO NOTHING;

