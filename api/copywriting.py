"""成就卡片文案配置文件。

运营和产品同学可以直接编辑这里的模板文案，不需要改动业务逻辑代码。
"""

import datetime
from typing import Optional


ACHIEVEMENT_TEMPLATES: dict[tuple[str, str], list[dict[str, str]]] = {
    ("comments", "burst"): [
        {
            "emoji": "🔥",
            "headline": "评论区沸腾爆发",
            "copy": "{compare}多了 {delta} 条留言，评论区像开麦一样越聊越热。",
        },
        {
            "emoji": "📣",
            "headline": "讨论节奏拉爆了",
            "copy": "{compare}互动猛增 {delta} 条，大家已经不只是看看，是真在聊。",
        },
        {
            "emoji": "⚡️",
            "headline": "评论炸开锅",
            "copy": "{compare}多了 {delta} 条评论，像一群人同时抢着接话，热闹感一下顶上来了。",
        },
        {
            "emoji": "🎯",
            "headline": "话题钩住人",
            "copy": "{compare}新增 {delta} 条留言，这条内容像抛了个准钩子，把人都拽进评论区了。",
        },
        {
            "emoji": "🚀",
            "headline": "接话停不下",
            "copy": "{compare}猛涨 {delta} 条评论，讨论像滚雪球一样越滚越大，停都停不住。",
        },
    ],
    ("comments", "strong"): [
        {
            "emoji": "💬",
            "headline": "对话势头稳步推高",
            "copy": "{compare}多出 {delta} 条评论，互动密度稳着往上走。",
        },
        {
            "emoji": "💬",
            "headline": "留言热度在涨",
            "copy": "{compare}新添 {delta} 条留言，评论区的接话速度越来越快。",
        },
        {
            "emoji": "👍",
            "headline": "接话的人多了",
            "copy": "{compare}多了 {delta} 条评论，大家顺着话头往下聊，讨论感稳稳托起来了。",
        },
        {
            "emoji": "📈",
            "headline": "评论往上走",
            "copy": "{compare}新增 {delta} 条留言，评论区不再安静，来回接招的人明显更多。",
        },
        {
            "emoji": "🌟",
            "headline": "话头接起来了",
            "copy": "{compare}涨了 {delta} 条评论，互动像接力一样传开，节奏越来越顺。",
        },
    ],
    ("comments", "mild"): [
        {
            "emoji": "👀",
            "headline": "评论气氛微升",
            "copy": "{compare}多了 {delta} 条评论，大家开始愿意停下来接话了。",
        },
        {
            "emoji": "📊",
            "headline": "讨论温度在动",
            "copy": "{compare}涨了 {delta} 条留言，互动火苗已经慢慢点起来。",
        },
        {
            "emoji": "🌱",
            "headline": "有人开始接话",
            "copy": "{compare}多了 {delta} 条评论，原本安静的地方开始有人搭话，气氛在慢慢醒来。",
        },
        {
            "emoji": "🍃",
            "headline": "评论冒小芽",
            "copy": "{compare}新增 {delta} 条留言，讨论像刚冒头的小芽，已经能看见往上长的意思了。",
        },
        {
            "emoji": "✏️",
            "headline": "话题有回声",
            "copy": "{compare}涨了 {delta} 条评论，大家开始留下只言片语，回应感一点点聚起来了。",
        },
    ],
    ("comments", "debut"): [
        {
            "emoji": "🎯",
            "headline": "首次破零",
            "copy": "第一次收获 {delta} 条评论，评论区终于从安静变成有人接话。",
        },
        {
            "emoji": "🌱",
            "headline": "零基础起步",
            "copy": "从 0 到 {delta} 条留言，第一波交流已经冒出来了。",
        },
        {
            "emoji": "✨",
            "headline": "新芽初绽",
            "copy": "首次攒下 {delta} 条评论，话题开始长出第一圈回应。",
        },
        {
            "emoji": "🚀",
            "headline": "从无到有",
            "copy": "从没有人说话到收进 {delta} 条评论，互动入口算是正式打开。",
        },
        {
            "emoji": "🎊",
            "headline": "首期达成",
            "copy": "首期拿到 {delta} 条留言，评论区终于有了第一阵热乎气。",
        },
    ],
    ("likes", "burst"): [
        {
            "emoji": "✨",
            "headline": "小心心爆发连跳",
            "copy": "{compare}多了 {delta} 个赞，认可度像刷屏一样蹿起来。",
        },
        {
            "emoji": "🚀",
            "headline": "点赞势能拉爆",
            "copy": "{compare}点赞猛冲 {delta} 次，内容明显戳中了更多人。",
        },
        {
            "emoji": "🔥",
            "headline": "赞像雪片飞",
            "copy": "{compare}多了 {delta} 个赞，小心心像下雪一样往下飘，认可感一下铺满了。",
        },
        {
            "emoji": "⚡️",
            "headline": "拇指按不停",
            "copy": "{compare}新增 {delta} 个点赞，大家像被同一个点戳中，拇指一路按个不停。",
        },
        {
            "emoji": "🎯",
            "headline": "一下戳中人",
            "copy": "{compare}猛增 {delta} 个赞，这条内容像正中靶心，喜欢来得又快又密。",
        },
    ],
    ("likes", "strong"): [
        {
            "emoji": "👍",
            "headline": "喜欢值稳步走高",
            "copy": "{compare}新增 {delta} 个点赞，大家对这条内容更买账了。",
        },
        {
            "emoji": "⭐",
            "headline": "认可热度在涨",
            "copy": "{compare}多出 {delta} 个小心心，拇指反馈越来越密。",
        },
        {
            "emoji": "💪",
            "headline": "点赞接着来",
            "copy": "{compare}多了 {delta} 个点赞，认可不是一阵风，正一波接一波往上垒。",
        },
        {
            "emoji": "📈",
            "headline": "小心心变密",
            "copy": "{compare}新增 {delta} 个赞，喜欢这件事越来越集中，反馈密度肉眼可见地上来了。",
        },
        {
            "emoji": "🌟",
            "headline": "顺手点的人多",
            "copy": "{compare}涨了 {delta} 个点赞，更多人愿意顺手留个喜欢，势头挺稳。",
        },
    ],
    ("likes", "mild"): [
        {
            "emoji": "👀",
            "headline": "点赞手感微升",
            "copy": "{compare}多了 {delta} 个赞，喜欢这件事已经在悄悄发生。",
        },
        {
            "emoji": "🌱",
            "headline": "认可曲线在动",
            "copy": "{compare}涨了 {delta} 个点赞，内容开始慢慢攒起口碑。",
        },
        {
            "emoji": "🍃",
            "headline": "点赞有动静",
            "copy": "{compare}多了 {delta} 个赞，喜欢的信号开始冒出来，数据在悄悄抬头。",
        },
        {
            "emoji": "✏️",
            "headline": "有人顺手点",
            "copy": "{compare}新增 {delta} 个点赞，越来越多人愿意顺手点一下，苗头已经看得见。",
        },
        {
            "emoji": "📊",
            "headline": "认可在发芽",
            "copy": "{compare}涨了 {delta} 个赞，内容的好感度正慢慢攒起来，不着急但在往上走。",
        },
    ],
    ("likes", "debut"): [
        {
            "emoji": "🎯",
            "headline": "首次破零",
            "copy": "第一次攒到 {delta} 个赞，认可终于从 0 开始起跳。",
        },
        {
            "emoji": "🌱",
            "headline": "零基础起步",
            "copy": "从没有点赞到拿下 {delta} 个小心心，第一波喜欢已经到场。",
        },
        {
            "emoji": "✨",
            "headline": "新芽初绽",
            "copy": "首次收进 {delta} 个赞，内容开始长出最早一批认可。",
        },
        {
            "emoji": "🚀",
            "headline": "从无到有",
            "copy": "从 0 到 {delta} 个点赞，喜欢这件事终于被点亮了。",
        },
        {
            "emoji": "🎊",
            "headline": "首期达成",
            "copy": "首期拿到 {delta} 个赞，内容算是真正迎来了第一波好感反馈。",
        },
    ],
    ("saves", "burst"): [
        {
            "emoji": "✨",
            "headline": "收藏夹爆发进货",
            "copy": "{compare}多了 {delta} 次收藏，内容已经被不少人收进口袋。",
        },
        {
            "emoji": "🔥",
            "headline": "存下欲望拉爆",
            "copy": "{compare}新增 {delta} 次收藏，这波内容很有留着反复看的劲。",
        },
        {
            "emoji": "🚀",
            "headline": "收藏塞满了",
            "copy": "{compare}多了 {delta} 次收藏，大家像在疯狂囤货，生怕这条内容回头找不着。",
        },
        {
            "emoji": "📣",
            "headline": "口袋装不停",
            "copy": "{compare}新增 {delta} 次收藏，内容像被一把把揣进口袋，留用意愿一下冲高。",
        },
        {
            "emoji": "⚡️",
            "headline": "先存再说了",
            "copy": "{compare}猛涨 {delta} 次收藏，很多人已经不是看看就走，而是先存起来慢慢翻。",
        },
    ],
    ("saves", "strong"): [
        {
            "emoji": "⭐",
            "headline": "收藏意愿稳步变强",
            "copy": "{compare}多出 {delta} 次收藏，大家开始把它当长期资料了。",
        },
        {
            "emoji": "👍",
            "headline": "留用热度在涨",
            "copy": "{compare}新增 {delta} 次存下，内容耐看度正在往上走。",
        },
        {
            "emoji": "💪",
            "headline": "越看越想存",
            "copy": "{compare}多了 {delta} 次收藏，内容的实用感稳稳出来了，看到的人更愿意先留住。",
        },
        {
            "emoji": "📈",
            "headline": "收藏排起来",
            "copy": "{compare}新增 {delta} 次存下，大家开始把它当备忘资料，留着以后再翻。",
        },
        {
            "emoji": "🌟",
            "headline": "存下的人多了",
            "copy": "{compare}涨了 {delta} 次收藏，愿意留档的人明显变多，内容价值感在往上走。",
        },
    ],
    ("saves", "mild"): [
        {
            "emoji": "📊",
            "headline": "收藏动作微升",
            "copy": "{compare}多了 {delta} 次收藏，长尾价值已经开始冒头。",
        },
        {
            "emoji": "🌱",
            "headline": "口袋入口在动",
            "copy": "{compare}涨了 {delta} 次存下，用户愿意把它先留着慢慢看。",
        },
        {
            "emoji": "👀",
            "headline": "收藏有苗头",
            "copy": "{compare}多了 {delta} 次收藏，已经有人觉得这条值得留着，长尾价值开始露头。",
        },
        {
            "emoji": "🍃",
            "headline": "先留着看看",
            "copy": "{compare}新增 {delta} 次存下，用户开始有“先收起来”的动作，说明内容在慢慢入心。",
        },
        {
            "emoji": "✏️",
            "headline": "口袋里见面",
            "copy": "{compare}涨了 {delta} 次收藏，这条内容正一点点进到大家的收藏夹里，占个位置。",
        },
    ],
    ("saves", "debut"): [
        {
            "emoji": "🎯",
            "headline": "首次破零",
            "copy": "第一次拿到 {delta} 次收藏，内容终于被人认真留了下来。",
        },
        {
            "emoji": "🌱",
            "headline": "零基础起步",
            "copy": "从 0 到 {delta} 次存下，第一批“先收藏再说”的动作已经出现。",
        },
        {
            "emoji": "✨",
            "headline": "新芽初绽",
            "copy": "首次收进 {delta} 次收藏，内容开始显出可反复翻看的价值。",
        },
        {
            "emoji": "🚀",
            "headline": "从无到有",
            "copy": "从没人存到积累 {delta} 次收藏，这条内容终于进了别人的口袋。",
        },
        {
            "emoji": "🎊",
            "headline": "首期达成",
            "copy": "首期攒下 {delta} 次收藏，留用价值已经迈出第一步。",
        },
    ],
    ("dms", "burst"): [
        {
            "emoji": "📣",
            "headline": "私信入口爆发开闸",
            "copy": "{compare}多了 {delta} 条私信，主动找上门的人明显涌进来了。",
        },
        {
            "emoji": "🚀",
            "headline": "来撩人数拉爆",
            "copy": "{compare}新增 {delta} 条私信，意向用户开始排队打招呼。",
        },
        {
            "emoji": "🔥",
            "headline": "私信挤进来",
            "copy": "{compare}多了 {delta} 条私信，消息框像开了闸，想聊的人一下都涌过来了。",
        },
        {
            "emoji": "⚡️",
            "headline": "对话找上门",
            "copy": "{compare}新增 {delta} 条私信，主动开口的人明显变多，线索自己在敲门。",
        },
        {
            "emoji": "🎯",
            "headline": "招呼声不断",
            "copy": "{compare}猛增 {delta} 条来聊，意向像连珠炮一样冒出来，停不下来。",
        },
    ],
    ("dms", "strong"): [
        {
            "emoji": "📩",
            "headline": "主动开口稳步在涨",
            "copy": "{compare}多出 {delta} 条私信，愿意先聊的人越来越多。",
        },
        {
            "emoji": "💬",
            "headline": "私聊热度稳着走高",
            "copy": "{compare}新增 {delta} 条来撩，转化前的信号更密了。",
        },
        {
            "emoji": "💪",
            "headline": "消息在排队",
            "copy": "{compare}多了 {delta} 条私信，想进一步了解的人在变多，转化前的动作很扎实。",
        },
        {
            "emoji": "📈",
            "headline": "来聊的人多",
            "copy": "{compare}新增 {delta} 条私信，主动交流的门已经被推开，节奏稳稳往上。",
        },
        {
            "emoji": "🌟",
            "headline": "对话在升温",
            "copy": "{compare}涨了 {delta} 条来撩，用户愿意先开口的意愿更明显了。",
        },
    ],
    ("dms", "mild"): [
        {
            "emoji": "👀",
            "headline": "私信苗头微升",
            "copy": "{compare}多了 {delta} 条私信，已经有人开始主动靠近了。",
        },
        {
            "emoji": "🌱",
            "headline": "招呼声在动",
            "copy": "{compare}涨了 {delta} 条来聊，意向线索正慢慢冒出来。",
        },
        {
            "emoji": "🍃",
            "headline": "有人来敲门",
            "copy": "{compare}多了 {delta} 条私信，已经能听见零星敲门声，意向在慢慢靠近。",
        },
        {
            "emoji": "📊",
            "headline": "私聊有回声",
            "copy": "{compare}新增 {delta} 条来聊，消息框开始有回声，说明兴趣正在积起来。",
        },
        {
            "emoji": "✏️",
            "headline": "招呼慢慢多",
            "copy": "{compare}涨了 {delta} 条私信，主动问一句的人一点点变多，线索苗头已经出现。",
        },
    ],
    ("dms", "debut"): [
        {
            "emoji": "🎯",
            "headline": "首次破零",
            "copy": "第一次收到 {delta} 条私信，终于有人主动找上门来聊了。",
        },
        {
            "emoji": "🌱",
            "headline": "零基础起步",
            "copy": "从 0 到 {delta} 条来聊，第一批意向线索已经开始冒头。",
        },
        {
            "emoji": "✨",
            "headline": "新芽初绽",
            "copy": "首次迎来 {delta} 条私信，对话入口终于长出了第一簇新芽。",
        },
        {
            "emoji": "🚀",
            "headline": "从无到有",
            "copy": "从没人私聊到收进 {delta} 条消息，主动沟通这扇门已经打开。",
        },
        {
            "emoji": "🎊",
            "headline": "首期达成",
            "copy": "首期拿下 {delta} 条私信，线索开始真正敲响第一声门铃。",
        },
    ],
    ("reach", "burst"): [
        {
            "emoji": "📣",
            "headline": "触达面爆发刷开",
            "copy": "{compare}多被看见 {delta} 次，内容扩散得像一波接一波。",
        },
        {
            "emoji": "🔥",
            "headline": "曝光势能拉爆",
            "copy": "{compare}新增 {delta} 次触达，账号存在感一下子冲上来了。",
        },
        {
            "emoji": "🚀",
            "headline": "刷屏感来了",
            "copy": "{compare}多被看见 {delta} 次，内容像被风推着跑，露面的频率一下蹿起来。",
        },
        {
            "emoji": "⚡️",
            "headline": "存在感冲高",
            "copy": "{compare}新增 {delta} 次触达，账号像突然站到人群中央，被看见的机会猛地放大。",
        },
        {
            "emoji": "🎯",
            "headline": "露脸停不住",
            "copy": "{compare}猛涨 {delta} 次曝光，内容一波波撞进视线里，存在感压都压不住。",
        },
    ],
    ("reach", "strong"): [
        {
            "emoji": "👍",
            "headline": "触达半径稳步外扩",
            "copy": "{compare}多了 {delta} 次触达，被看见的范围稳着变大。",
        },
        {
            "emoji": "⭐",
            "headline": "曝光曲线在涨",
            "copy": "{compare}新增 {delta} 次曝光，内容正在越过原来的圈层。",
        },
        {
            "emoji": "💪",
            "headline": "越传越开",
            "copy": "{compare}多了 {delta} 次触达，被看见这件事正在稳稳扩圈，覆盖面更开了。",
        },
        {
            "emoji": "📈",
            "headline": "刷到的人多",
            "copy": "{compare}新增 {delta} 次曝光，内容开始越过原来那层人群，往外推得很顺。",
        },
        {
            "emoji": "🌟",
            "headline": "露脸更勤了",
            "copy": "{compare}涨了 {delta} 次被看见，账号在用户面前出现得更频繁，势头挺明显。",
        },
    ],
    ("reach", "mild"): [
        {
            "emoji": "📊",
            "headline": "被看见在动",
            "copy": "{compare}多了 {delta} 次触达，扩散面已经开始慢慢铺开。",
        },
        {
            "emoji": "👀",
            "headline": "曝光势头微升",
            "copy": "{compare}涨了 {delta} 次被看见，刷到你的人正一点点变多。",
        },
        {
            "emoji": "🌱",
            "headline": "存在感冒头",
            "copy": "{compare}多了 {delta} 次触达，被看见的次数开始往上拱，苗头已经出来了。",
        },
        {
            "emoji": "🍃",
            "headline": "刷到开始多",
            "copy": "{compare}新增 {delta} 次曝光，更多人开始在时间线上碰见你，扩散轻轻铺开。",
        },
        {
            "emoji": "✏️",
            "headline": "露脸有起色",
            "copy": "{compare}涨了 {delta} 次触达，存在感正在一点点站稳，不算猛但很清楚。",
        },
    ],
    ("reach", "debut"): [
        {
            "emoji": "🎯",
            "headline": "首次破零",
            "copy": "第一次拿到 {delta} 次触达，内容终于正式被看见了。",
        },
        {
            "emoji": "🌱",
            "headline": "零基础起步",
            "copy": "从 0 到 {delta} 次曝光，第一批看到你的人已经出现。",
        },
        {
            "emoji": "✨",
            "headline": "新芽初绽",
            "copy": "首次积累 {delta} 次触达，存在感开始冒出第一层外圈。",
        },
        {
            "emoji": "🚀",
            "headline": "从无到有",
            "copy": "从没有曝光到被看见 {delta} 次，传播终于真正起跑。",
        },
        {
            "emoji": "🎊",
            "headline": "首期达成",
            "copy": "首期完成 {delta} 次触达，账号第一次把声音送到了外面。",
        },
    ],
    ("successCount", "burst"): [
        {
            "emoji": "🚀",
            "headline": "收工清单爆发推进",
            "copy": "{compare}多搞定 {delta} 个任务，这波执行力已经直接拉满。",
        },
        {
            "emoji": "🔥",
            "headline": "落地节奏拉爆",
            "copy": "{compare}新增 {delta} 个完成项，产能像开了倍速一样往前冲。",
        },
        {
            "emoji": "⚡️",
            "headline": "搞定得飞快",
            "copy": "{compare}多搞定 {delta} 个任务，推进像连点确认一样，一路清单一路消。",
        },
        {
            "emoji": "🎯",
            "headline": "清单哗哗掉",
            "copy": "{compare}新增 {delta} 个完成项，待办像被成排划掉，落地速度相当猛。",
        },
        {
            "emoji": "✨",
            "headline": "进度条冲刺",
            "copy": "{compare}猛增 {delta} 个搞定项，执行状态像开了冲刺键，往前拱得特别快。",
        },
    ],
    ("successCount", "strong"): [
        {
            "emoji": "👍",
            "headline": "跑成效率稳步在涨",
            "copy": "{compare}多完成 {delta} 个任务，推进节奏稳着往前压。",
        },
        {
            "emoji": "⭐",
            "headline": "收工速度在涨",
            "copy": "{compare}新增 {delta} 个搞定项，任务清单正在清得更快。",
        },
        {
            "emoji": "💪",
            "headline": "任务收得快",
            "copy": "{compare}多完成 {delta} 个任务，清单被稳稳往下收，效率感很实在。",
        },
        {
            "emoji": "📈",
            "headline": "推进在加速",
            "copy": "{compare}新增 {delta} 个完成项，执行节奏越来越顺，事情一件件落到地上。",
        },
        {
            "emoji": "🌟",
            "headline": "收工更顺手",
            "copy": "{compare}涨了 {delta} 个搞定项，团队把事情做完的手感明显更好了。",
        },
    ],
    ("successCount", "mild"): [
        {
            "emoji": "📊",
            "headline": "产能曲线微升",
            "copy": "{compare}多了 {delta} 个完成项，执行节奏已经开始提起来。",
        },
        {
            "emoji": "🌱",
            "headline": "落地动作在动",
            "copy": "{compare}涨了 {delta} 个搞定项，清单正被一点点收掉。",
        },
        {
            "emoji": "👀",
            "headline": "清单开始瘦",
            "copy": "{compare}多了 {delta} 个完成项，待办清单开始慢慢变薄，推进感已经有了。",
        },
        {
            "emoji": "🍃",
            "headline": "事情在落地",
            "copy": "{compare}新增 {delta} 个搞定项，执行动作一点点接上，节奏正慢慢顺起来。",
        },
        {
            "emoji": "✏️",
            "headline": "收工有苗头",
            "copy": "{compare}涨了 {delta} 个完成项，进度条悄悄往前走，落地感开始出现。",
        },
    ],
    ("successCount", "debut"): [
        {
            "emoji": "🎯",
            "headline": "首次破零",
            "copy": "第一次搞定 {delta} 个任务，执行清单终于从 0 开始推进。",
        },
        {
            "emoji": "🌱",
            "headline": "零基础起步",
            "copy": "从没有完成项到收下 {delta} 个搞定项，第一波落地结果已经出现。",
        },
        {
            "emoji": "✨",
            "headline": "新芽初绽",
            "copy": "首次完成 {delta} 个任务，执行力开始长出第一段实绩。",
        },
        {
            "emoji": "🚀",
            "headline": "从无到有",
            "copy": "从 0 到搞定 {delta} 个任务，推进节奏终于正式跑起来了。",
        },
        {
            "emoji": "🎊",
            "headline": "首期达成",
            "copy": "首期完成 {delta} 个任务，清单第一次被真实往前推了一大步。",
        },
    ],
    ("totalReach", "burst"): [
        {
            "emoji": "📣",
            "headline": "全网覆盖爆发铺开",
            "copy": "{compare}多覆盖 {delta} 人次，扩散面已经从点状变成大片。",
        },
        {
            "emoji": "🚀",
            "headline": "扩散大盘拉爆",
            "copy": "{compare}新增 {delta} 人次覆盖，被看见这事直接飙起来了。",
        },
        {
            "emoji": "🔥",
            "headline": "铺面一下开",
            "copy": "{compare}多覆盖 {delta} 人次，扩散像把幕布猛地拉开，看到你的人一下大片变多。",
        },
        {
            "emoji": "⚡️",
            "headline": "声量冲出去",
            "copy": "{compare}新增 {delta} 人次覆盖，内容像被推上更大的场子，外溢感非常明显。",
        },
        {
            "emoji": "🎯",
            "headline": "全网都刷到",
            "copy": "{compare}猛涨 {delta} 人次触达，扩散面一层层铺出去，存在感直接抬头。",
        },
    ],
    ("totalReach", "strong"): [
        {
            "emoji": "👍",
            "headline": "覆盖面积稳步扩开",
            "copy": "{compare}多了 {delta} 人次覆盖，全网铺开的感觉越来越明显。",
        },
        {
            "emoji": "⭐",
            "headline": "扩散盘子在涨",
            "copy": "{compare}新增 {delta} 人次触达，整体声量稳着往外推。",
        },
        {
            "emoji": "💪",
            "headline": "盘子越铺越大",
            "copy": "{compare}多了 {delta} 人次覆盖，整体扩散盘子在稳稳变大，声量往外推得更远。",
        },
        {
            "emoji": "📈",
            "headline": "看到你的人多",
            "copy": "{compare}新增 {delta} 人次触达，被覆盖到的人越来越多，外圈人群开始接上了。",
        },
        {
            "emoji": "🌟",
            "headline": "声量抬起来了",
            "copy": "{compare}涨了 {delta} 人次覆盖，整体存在感更足，扩散效果肉眼可见地往上走。",
        },
    ],
    ("totalReach", "mild"): [
        {
            "emoji": "👀",
            "headline": "覆盖曲线微升",
            "copy": "{compare}多了 {delta} 人次覆盖，扩散范围已经开始往外抹开。",
        },
        {
            "emoji": "📊",
            "headline": "全网势头在动",
            "copy": "{compare}涨了 {delta} 人次触达，更多角落开始刷到你了。",
        },
        {
            "emoji": "🌱",
            "headline": "覆盖在冒头",
            "copy": "{compare}多了 {delta} 人次覆盖，整体扩散开始有抬头迹象，范围在慢慢伸开。",
        },
        {
            "emoji": "🍃",
            "headline": "声量轻轻涨",
            "copy": "{compare}新增 {delta} 人次触达，更多边角位置开始刷到你，盘子在悄悄变大。",
        },
        {
            "emoji": "✏️",
            "headline": "外圈接上了",
            "copy": "{compare}涨了 {delta} 人次覆盖，覆盖面正一点点往外接，苗头已经很清楚。",
        },
    ],
}


def magnitude_bucket(change_pct: float) -> str:
    if change_pct >= 30:
        return "burst"
    if change_pct >= 15:
        return "strong"
    if change_pct >= 5:
        return "mild"
    if change_pct >= 0:
        return "flat"
    return "decline"


def generate_achievement(
    metric: str,
    cur: float,
    prev: float,
    range_label: str,
) -> Optional[dict[str, object]]:
    if cur <= 0 or prev < 0:
        return None

    if prev == 0:
        change_pct = 0
        bucket = "debut"
    else:
        change_pct = (cur - prev) / prev * 100
        bucket = magnitude_bucket(change_pct)
        if bucket in {"flat", "decline"}:
            return None

    templates = ACHIEVEMENT_TEMPLATES.get((metric, bucket))
    if not templates:
        return None

    day_seed = datetime.date.today().isoformat()
    template = templates[hash((day_seed, metric, range_label, bucket)) % len(templates)]
    delta = abs(cur - prev)
    if bucket == "debut":
        copy = template["copy"].format(delta=delta)
    else:
        copy = template["copy"].format(delta=delta, compare=range_label)
    if prev == 0 and cur > 0:
        theme = "gold" if cur >= 50 else "green" if cur >= 10 else "blue"
    else:
        theme = "gold" if bucket == "burst" else "green" if bucket == "strong" else "blue"

    return {
        "key": f"{metric}_{bucket}",
        "metric": metric,
        "emoji": template["emoji"],
        "headline": template["headline"],
        "change_pct": round(change_pct),
        "compare": range_label,
        "current": cur,
        "prev": prev,
        "delta_text": f"{range_label[1:]} {prev} → 本期 {cur}",
        "copy": copy,
        "theme": theme,
    }
