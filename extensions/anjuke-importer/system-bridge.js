/* 在择隅系统页面运行：把登录态同步给插件，供「一键导入」使用。
 * 只读当前系统页的存储，不上传、不改动系统页面。
 * v1.5.0：系统登录态改存 sessionStorage（关浏览器即失效），这里优先读 sessionStorage，
 * 再回落 localStorage 兼容老版本；只在「当前页面就是要推送的系统」时才同步 token。 */
(function () {
  try {
    const token = sessionStorage.getItem('hvt_token') || localStorage.getItem('hvt_token');
    if (!token || !window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
    const origin = location.origin;
    chrome.storage.local.get('hvt_ajk_cfg', function (r) {
      // F138：异步回调必须检查 lastError，避免上下文失效时静默不同步
      if (chrome.runtime.lastError) {
        console.warn('[HVT] 读取插件配置失败：' + chrome.runtime.lastError.message);
        return;
      }
      const cfg = r && r.hvt_ajk_cfg;
      const rawBase = cfg && cfg.base ? String(cfg.base) : '';
      let base = '';
      // F139：new URL(base).origin 归一化后再比较，避免路径/大小写/端口差异导致永不同步
      if (rawBase) {
        try { base = new URL(rawBase).origin; }
        catch (e) { console.warn('[HVT] 插件配置的地址无效，跳过登录态同步'); return; }
      }
      if (base && base !== origin) return;
      chrome.runtime.sendMessage({ type: 'HVT_TOKEN', token: token, base: origin }, function () {
        if (chrome.runtime.lastError) console.warn('[HVT] 同步登录态失败：' + chrome.runtime.lastError.message);
      });
    });
  } catch (e) { /* 隐私模式或未登录时忽略 */ }
})();
