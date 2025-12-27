## bugfarm 解释

1. Crash / Blank Screen（崩溃 / 白屏）
crash_01：点击后立即触发崩溃（C0，最简单）
crash_02：先输入内容，再提交就会崩溃（C1）
crash_03：先导航到详情页，在详情页触发崩溃（C2）
crash_04：执行一系列 “嘈杂操作”（比如频繁点击 / 输入）后崩溃（C3，最复杂）
crash_05：崩溃时会在控制台（DevTools）留下提示（C1）
1. Interaction No Response（交互无响应）
no_response_01：提交按钮点击后完全没反应（C0）
no_response_02：点击后弹出 “成功提示”，但实际状态没变化（假成功，C1）
no_response_03：有隐藏前提（比如需要勾选复选框），但没有提示，导致操作无响应（C2）
no_response_04：页面上有透明遮罩层，遮挡了可点击区域，导致点击没反应（C3）
no_response_05：操作本应触发 API 请求，但实际没有发送请求（C1）
1. UI Layout / Styling Issue（界面布局 / 样式问题）
ui_issue_01：布局错乱，卡片元素重叠（C0）
ui_issue_02：暗黑模式下文字颜色和背景对比度太低，导致文字看不清（C1）
ui_issue_03：调整窗口大小时，响应式布局失效（C2）
ui_issue_04：滚动页面后，“粘性头部” 遮挡了内容（C3）
ui_issue_05：长文本（l18n 国际化文本）溢出容器，遮挡了其他 UI 元素（C1）
1. Data Wrong / Not Updated（数据错误 / 未更新）
data_wrong_01：添加元素时，计数器数值增加，但列表内容没更新（C0）
data_wrong_02：列表内容更新了，但计数器数值没变化（C1）
data_wrong_03：切换标签页时，显示的是旧数据（ stale data，C2）
data_wrong_04：快速点击按钮导致计数不匹配（竞态问题，C3）
data_wrong_05：模拟 API 请求成功，但界面状态没更新（C1）
1. Flow Stuck / Navigation Error（流程卡住 / 导航错误）
flow_nav_01：点击 “下一步” 没反应，流程卡住（C0）
flow_nav_02：导航到不存在的页面（显示 404，C1）
flow_nav_03：进入 A 入口正常，进入 B 入口失败（缺少参数，C2）
flow_nav_04：加载状态无限显示（Promise 一直没 resolve，C3）
flow_nav_05：返回按钮的行为不符合预期（C1）
1. Auth / Permission（权限 / 认证问题）
auth_01：受限页面直接显示 “未登录”（C0）
auth_02：操作返回 401（未授权），然后跳转到登录页（C1）
auth_03：登录成功后，令牌立即过期（C2）
auth_04：在登录页和受限页面之间无限重定向（C3）
auth_05：403 错误（权限不足）被显示为 “未知错误”（误导性提示，C1）
1. Error Message / UX Error（错误提示 / 体验错误）
error_message_01：请求失败，但页面完全没显示错误提示（C0，最简单）
error_message_02：实际故障对应的错误文本显示错误（比如 “网络错误” 显示成 “参数错误”，C1）
error_message_03：同一个错误触发了重复的提示弹窗（toast）（C2）
error_message_04：错误提示弹窗只闪了一下就消失，用户来不及看到（C3，最复杂）
error_message_05：加载状态一直显示（没结束），且没有任何错误提示（C1）
1. Performance / Lag（性能 / 卡顿）
perf_01：接口请求很慢，结果要 5 秒后才显示（C0）
perf_02：列表内容过多 / 过重，导致滚动时卡顿（C1）
perf_03：因为后台有 heavy 计算，输入文字时出现延迟（C2）
perf_04：重复点击会让操作队列堆积，导致页面越来越卡（C3）
perf_05：慢网络 + 繁重的渲染操作同时发生，双重影响性能（C1）