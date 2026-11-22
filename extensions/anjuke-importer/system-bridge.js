/* 在择隅系统页面运行：把登录态同步给插件，供「一键导入」使用。
 * 只读当前系统页的存储，不上传、不改动系统页面。
 * v1.5.0：系统登录态改存 sessionStorage（关浏览器即失效），这里优先读 sessionStorage，
 * 再回落 localStorage 兼容老版本；只在「当前页面就是要推送的系统」时才同步 token。 */
(function () {
  try {
    var token = sessionStorage.getItem('hvt_token') || localStorage.getItem('hvt_token');
    if (!token || !window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
    var origin = location.origin;
    chrome.storage.local.get('hvt_ajk_cfg', function (r) {
      var cfg = r && r.hvt_ajk_cfg;
      var base = cfg && String(cfg.base || '').replace(/\/+$/, '');
      if (base && base !== origin) return;
      chrome.runtime.sendMessage({ type: 'HVT_TOKEN', token: token, base: origin });
    });
  } catch (e) { /* 隐私模式或未登录时忽略 */ }
})();
