// auth.js —— 登录 / 注册 / 找回密码 / 会话管理（对接本地后端 + 自研令牌）
// 对外暴露与原来 Supabase 调用方兼容的接口：
//   Auth.init() / Auth.signOut() / Auth.getSession() / Auth.onAuthStateChange(cb)
//
// 登录页按参考图重做：邮箱验证码内联输入，图形验证码保持弹窗。
//   · 密码登录  ：邮箱 + 密码；点「登录」先走无感（PoW + 行为评分），服务端要验证码才弹窗
//   · 验证码登录：邮箱 + 邮箱验证码（免密），点「获取验证码」同样先走无感
//   · 注册 / 找回密码：仍走邮箱验证码（验证邮箱真实性），复用同一套发码通道
// 安全链路：所有提交都带 BotGuard 的一次性算力证明（PoW）；邮箱码一次性、10 分钟、错 5 次作废。
// 注意：只有「图形验证码」是弹窗（#captcha-modal），邮箱验证码永远在表单里输入，不要再给它加弹窗。
// 图形验证码的算式与候选数字都画在同一张图里，用户点图中数字作答；不要退回下面那排数字按钮。
const Auth = (function () {
  let mode = 'code';        // code | password | signup | reset
  const listeners = [];
  let capData = null;       // 当前图形挑战 { id, a, b, op, options }
  let capAction = '';       // 'email-code' | 'password-login'
  let sentEmail = '';       // 已成功发码的邮箱（发码后不允许偷偷换邮箱）
  let sentPurpose = '';     // register | code-login | reset
  let tickTimer = null;
  let cooldownUntil = 0;    // 发码冷却到期时间戳（ms）：切换模式不清除，避免绕过前端冷却（F061）
  // 邮箱验证码总开关：由后端 /api/auth/config 下发，默认 false（未取到时按关闭处理，保证开箱即用）
  // false：登录页只有「密码登录」，注册只过图形验证码；true：显示验证码登录/找回密码完整流程
  let emailVerification = false;
  const REMEMBER_KEY = 'hvt_remember_email';
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // 策略常量：须与后端 server.js 的 PASSWORD_MIN / EMAIL_CODE_TTL / 发码限流保持一致（F057）。
  // 后端调整时同步这里，避免前端放行而后端拒绝。
  const PASSWORD_MIN = 8;
  const EMAIL_CODE_LEN = 6;
  const CODE_RESEND_SECONDS = 60;
  const CODE_RE = new RegExp('^\\d{' + EMAIL_CODE_LEN + '}$');

  const el = (id) => document.getElementById(id);
  const emailValue = () => (el('auth-email').value || '').trim().toLowerCase();

  function setMsg(text, ok) {
    const e = el('auth-msg');
    if (e) {
      e.textContent = text || '';
      e.style.color = ok ? 'var(--ok)' : 'var(--danger)';
    }
  }
  function setCapMsg(text) {
    const e = el('captcha-msg');
    if (e) e.textContent = text || '';
  }
  // 错误一律一行短句，不再写大段说明
  function shortError(raw) {
    const s = String(raw || '操作失败');
    if (/NEED_CAPTCHA/.test(s)) return '请先完成安全验证';
    if (/POW_INVALID|安全校验已过期/.test(s)) return '安全校验已过期，请重试';
    if (/无法连接服务器/.test(s)) return s;
    if (/尚未配置邮件服务|SMTP/.test(s)) return '邮件服务未配置，请联系管理员';
    if (/验证未通过/.test(s)) return '安全验证未通过，请重试';
    if (/验证码不正确|验证码不正确或已过期/.test(s)) return '验证码不正确或已过期';
    if (/已注册/.test(s)) return '该邮箱已注册，请直接登录';
    if (/尚未注册/.test(s)) return '该邮箱尚未注册';
    if (/有效邮箱/.test(s)) return '请输入有效的邮箱地址';
    if (/邮箱或密码不正确/.test(s)) return '邮箱或密码不正确';
    if (/至少 \d+ 位|新密码需/.test(s)) return s;
    if (/频繁|过多/.test(s)) return s;
    if (/未登录|过期/.test(s)) return '登录已过期，请重新登录';
    if (/原密码不正确/.test(s)) return s;
    if (/发送失败/.test(s)) return '验证码发送失败，请稍后重试';
    return s;
  }

  function getSession() {
    const tk = Api.token();
    const u = Api.currentUser();
    return (tk && u) ? { session: { user: u } } : { session: null };
  }
  function onAuthStateChange(cb) { listeners.push(cb); }
  function fire(event, session) {
    listeners.forEach((cb) => { try { cb(event, session); } catch (e) { console.error(e); } });
  }

  // ---------- 模式切换 ----------
  // code    : 邮箱 + 验证码
  // password: 邮箱 + 密码 + 记住密码/忘记密码
  // signup  : 邮箱 + 密码 + 验证码
  // reset   : 邮箱 + 验证码 + 新密码/确认密码
  function switchMode(to) {
    // 邮箱验证关闭时不允许进入 code / reset 模式（没有邮件通道，这两种无法安全工作）
    const allowed = ['code', 'password', 'signup', 'reset'].filter((m) => emailVerification || (m !== 'code' && m !== 'reset'));
    mode = allowed.indexOf(to) >= 0 ? to : (emailVerification ? 'code' : 'password');
    const loginTab = (mode === 'code' || mode === 'password');
    el('auth-seg').classList.toggle('hidden', !loginTab);
    document.querySelectorAll('#auth-seg .auth-seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
      // 关闭邮箱验证时隐藏「验证码登录」标签，只留密码登录
      if (b.dataset.mode === 'code') b.classList.toggle('hidden', !emailVerification);
    });
    el('auth-pass-field').classList.toggle('hidden', mode === 'code' || mode === 'reset');
    // 验证码输入框：密码登录隐藏；注册时仅在邮箱验证开启才显示（关闭时注册只填邮箱+密码）
    el('auth-code-field').classList.toggle('hidden', mode === 'password' || (mode === 'signup' && !emailVerification));
    el('auth-reset-fields').classList.toggle('hidden', mode !== 'reset');
    el('auth-extra').classList.toggle('hidden', mode !== 'password');
    // 关闭邮箱验证时隐藏「忘记密码」（无邮件无法找回）
    const forgot = el('auth-forgot');
    if (forgot) forgot.classList.toggle('hidden', !emailVerification);

    el('auth-submit').textContent = mode === 'signup' ? '注册'
      : (mode === 'reset' ? '重置密码' : '登录');
    const pw = el('auth-password');
    pw.autocomplete = (mode === 'signup' || mode === 'reset') ? 'new-password' : 'current-password';
    if (mode === 'signup') pw.setAttribute('minlength', String(PASSWORD_MIN));
    else pw.removeAttribute('minlength');

    el('auth-switch-tip').textContent = mode === 'signup' ? '已有账户？'
      : (mode === 'reset' ? '想起密码了？' : '还没有账户？');
    el('auth-switch-pre').textContent = mode === 'reset' ? '' : '立即';
    el('auth-switch-btn').textContent = mode === 'signup' ? '登录'
      : (mode === 'reset' ? '返回登录' : '注册');

    setMsg('');
    closeCaptcha();
    syncCountdownButton(); // 切换模式只重绘按钮，不清除冷却，避免提前解锁发码（F061）
    sentEmail = '';
    sentPurpose = '';
    scrubPasswords();
  }

  // 浏览器密码管理器会把登录密码填进注册/重置的新密码框：只认真人输入，其余清空。
  // 注意：绝不清 auth-password（登录框）——那是「记住密码」靠浏览器自动填充回填的框，
  // 清掉它会导致勾选记住密码后每次还要手输（v1.8.6 修复）。只清注册/重置的新密码框。
  function scrubPasswords() {
    ['auth-new-password', 'auth-new-password2'].forEach((id) => {
      const i = el(id);
      if (i && i.dataset.dirty !== '1') i.value = '';
    });
  }

  // ---------- 图形验证码弹窗：图由服务端渲染，前端只画图 + 铺点击热区 ----------
  // 前端拿不到算式和答案（响应里只有一张 SVG 和 6 个矩形坐标），提交的是「第几个」。
  function drawCaptchaImage(q) {
    const cv = el('captcha-canvas');
    if (!cv || !cv.getContext) return;
    const ctx = cv.getContext('2d');
    cv.__hits = [];
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!q || !q.image) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      // 热区顺序即提交的下标，与图片里的数字顺序一致
      cv.__hits = (q.hits || []).map((h, i) => ({ idx: i, x: h.x, y: h.y, w: h.w, h: h.h }));
    };
    img.onerror = () => setCapMsg('图形加载失败，点「换一个」重试');
    img.src = q.image;
  }
  function paintCaptcha(q) {
    capData = q;
    drawCaptchaImage(q);
    setCapMsg('');
  }
  async function openCaptcha(action) {
    capAction = action;
    el('captcha-modal').classList.remove('hidden');
    setCapMsg('加载中…');
    try {
      const r = await Api.captcha();
      paintCaptcha(r.data);
      setCapMsg('');
    } catch (e) {
      capData = null;
      const cv = el('captcha-canvas'); if (cv) cv.__hits = [];
      setCapMsg('加载失败，点「换一个」重试');
    }
  }
  function closeCaptcha() {
    el('captcha-modal').classList.add('hidden');
    const cv = el('captcha-canvas'); if (cv) cv.__hits = [];
    capData = null;
    capAction = '';
    setCapMsg('');
  }
  // 提交的是热区下标（服务端才知道它对应哪个数），前端全程不接触答案
  function chooseCaptcha(idx) {
    if (!capData) return;
    const cap = { id: capData.id, answer: idx };
    const action = capAction;
    closeCaptcha();
    if (action === 'password-login') submitPasswordLogin(cap);
    else if (action === 'signup-register') submitSignup(cap);  // 注册补答图形验证码后重提交
    else sendEmailCode(cap);
  }
  // 点图形框里的数字作答：把鼠标坐标按 canvas 缩放比换算，命中即提交；点空白处只提示、不消耗挑战
  function onCanvasClick(e) {
    const cv = el('captcha-canvas');
    if (!capData || !cv) return;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (cv.width / rect.width);
    const y = (e.clientY - rect.top) * (cv.height / rect.height);
    const hit = (cv.__hits || []).find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (!hit) { setCapMsg('请点击图中的数字'); return; }
    chooseCaptcha(hit.idx);
  }

  // ---------- 发邮箱验证码 ----------
  // 冷却用「到期时间戳」记录，切模式只重绘按钮不重置，防止通过切模式绕过前端冷却（F061）
  function startCountdown(sec) {
    stopCountdown();
    cooldownUntil = Date.now() + sec * 1000;
    const btn = el('auth-get-code');
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      if (btn) {
        btn.disabled = left > 0;
        btn.textContent = left > 0 ? left + 's 后重发' : '获取验证码';
      }
      if (left <= 0) { clearInterval(tickTimer); tickTimer = null; }
    };
    tick();
    tickTimer = setInterval(tick, 1000);
  }
  function stopCountdown() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    cooldownUntil = 0;
    const b = el('auth-get-code');
    if (b) { b.disabled = false; b.textContent = '获取验证码'; }
  }
  function syncCountdownButton() {
    const b = el('auth-get-code');
    if (!b) return;
    const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    b.disabled = left > 0;
    b.textContent = left > 0 ? left + 's 后重发' : '获取验证码';
  }
  function purposeOfMode() {
    return mode === 'signup' ? 'register' : (mode === 'reset' ? 'reset' : 'code-login');
  }
  async function sendEmailCode(cap, retried) {
    const email = emailValue();
    const purpose = purposeOfMode();
    if (!EMAIL_RE.test(email)) { setMsg('请输入有效的邮箱地址'); return; }
    setMsg('发送中…');
    try {
      const g = await BotGuard.attach();
      const r = await Api.emailCode(email, purpose, cap, g);
      sentEmail = email;
      sentPurpose = purpose;
      startCountdown(CODE_RESEND_SECONDS);
      setMsg(r.data && r.data.devMode ? '验证码已发送（开发模式见控制台）' : '验证码已发送', true);
      el('auth-email-code').focus();
    } catch (err) {
      const raw = (err && err.message) || ''; // F186: 拒绝值可能为 null / 非 Error
      // 挑战过期/已被用掉：换一个再试一次，用户无感
      if (/POW_INVALID/.test(raw) && !retried) { await BotGuard.reset(); return sendEmailCode(cap, true); }
      if (/已注册/.test(raw)) {
        switchMode('password');
        setMsg('该邮箱已注册，请直接登录');
        return;
      }
      if (/NEED_CAPTCHA/.test(raw)) { setMsg('请完成安全验证'); openCaptcha('email-code'); return; }
      setMsg(shortError(raw));
      // 图形验证码答错 / 过期：自动换一张，表单内容不动
      if (/验证未通过/.test(raw)) openCaptcha('email-code');
    }
  }
  function onGetCode() {
    if (tickTimer) return;
    if (!EMAIL_RE.test(emailValue())) { setMsg('请输入有效的邮箱地址'); el('auth-email').focus(); return; }
    setMsg('');
    sendEmailCode(null);   // 先走无感：服务端要验证码才弹窗
  }

  // ---------- 四种提交 ----------
  function finishLogin(data) {
    const { token, user } = data;
    try {
      if (el('auth-remember').checked) localStorage.setItem(REMEMBER_KEY, emailValue());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch { /* 隐私模式下 localStorage 可能不可写 */ }
    Api.setSession(token, user);
    fire('SIGNED_IN', { user });
  }
  function codeValue() { return (el('auth-email-code').value || '').trim(); }
  function assertCodeAndEmail(purpose) {
    const email = emailValue();
    if (!EMAIL_RE.test(email)) { setMsg('请输入有效的邮箱地址'); return false; }
    if (!CODE_RE.test(codeValue())) { setMsg('请输入 ' + EMAIL_CODE_LEN + ' 位验证码'); return false; }
    if (sentEmail !== email || sentPurpose !== purpose) { setMsg('请先获取验证码'); return false; }
    return true;
  }

  // 密码登录入口：先校验表单，然后直接带 PoW 提交（无感）。
  // 服务端按行为评分判断，回 NEED_CAPTCHA 才弹图形验证码；答对后由 chooseCaptcha 带 cap 再提交一次。
  function startPasswordLogin() {
    if (!el('captcha-modal').classList.contains('hidden')) return; // 弹窗已开着，别重复领挑战
    const email = emailValue(), pw = el('auth-password').value;
    if (!EMAIL_RE.test(email)) { setMsg('请输入有效的邮箱地址'); el('auth-email').focus(); return; }
    if (!pw) { setMsg('请输入密码'); el('auth-password').focus(); return; }
    setMsg('');
    submitPasswordLogin(null);
  }

  async function submitPasswordLogin(cap, retried) {
    const email = emailValue(), pw = el('auth-password').value;
    if (!EMAIL_RE.test(email)) { setMsg('请输入有效的邮箱地址'); return; }
    if (!pw) { setMsg('请输入密码'); return; }
    const btn = el('auth-submit');
    btn.disabled = true;
    setMsg('');
    try {
      const g = await BotGuard.attach();
      const data = await Api.login(email, pw, cap, g);
      finishLogin(data.data);
    } catch (err) {
      const raw = (err && err.message) || '';
      if (/POW_INVALID/.test(raw) && !retried) {
        await BotGuard.reset();
        btn.disabled = false;
        return submitPasswordLogin(cap, true);
      }
      if (/NEED_CAPTCHA/.test(raw)) { setMsg('请完成安全验证'); openCaptcha('password-login'); }
      else if (/验证未通过/.test(raw)) { setMsg('验证未通过，请重试'); openCaptcha('password-login'); }
      else setMsg(shortError(raw));
    } finally { btn.disabled = false; }
  }

  async function submitCodeLogin() {
    if (!assertCodeAndEmail('code-login')) return;
    const btn = el('auth-submit');
    btn.disabled = true; setMsg('');
    try {
      const data = await Api.loginByCode(emailValue(), codeValue());
      finishLogin(data.data);
    } catch (err) { setMsg(shortError(err && err.message)); }
    finally { btn.disabled = false; }
  }

  // 注册入口：先校验邮箱/密码，再带 PoW 无感提交；服务端要图形验证码才弹窗
  function startSignup() {
    const email = emailValue(), pw = el('auth-password').value;
    if (!EMAIL_RE.test(email)) { setMsg('请输入有效的邮箱地址'); el('auth-email').focus(); return; }
    if (pw.length < PASSWORD_MIN) { setMsg('密码至少 ' + PASSWORD_MIN + ' 位'); el('auth-password').focus(); return; }
    setMsg('');
    submitSignup(null);
  }

  async function submitSignup(cap, retried) {
    const pw = el('auth-password').value;
    if (pw.length < PASSWORD_MIN) { setMsg('密码至少 ' + PASSWORD_MIN + ' 位'); return; }
    // 开启邮箱验证时沿用邮箱验证码流程；关闭时靠 PoW + 服务端评分把关
    if (emailVerification && !assertCodeAndEmail('register')) return;
    const btn = el('auth-submit');
    btn.disabled = true; setMsg('');
    try {
      const g = await BotGuard.attach();
      const data = await Api.register(emailValue(), pw, emailVerification ? codeValue() : '', cap, g);
      finishLogin(data.data);
    } catch (err) {
      const raw = (err && err.message) || '';
      if (/POW_INVALID/.test(raw) && !retried) {
        await BotGuard.reset();
        btn.disabled = false;
        return submitSignup(cap, true);
      }
      if (/已注册/.test(raw)) { switchMode('password'); setMsg('该邮箱已注册，请直接登录'); }
      else if (/NEED_CAPTCHA/.test(raw)) { setMsg('请完成安全验证'); openCaptcha('signup-register'); }
      else if (/验证未通过/.test(raw)) { setMsg(shortError(raw)); openCaptcha('signup-register'); }
      else setMsg(shortError(raw));
    } finally { btn.disabled = false; }
  }

  async function submitReset() {
    if (!assertCodeAndEmail('reset')) return;
    const np = el('auth-new-password').value, np2 = el('auth-new-password2').value;
    if (np.length < PASSWORD_MIN) { setMsg('新密码至少 ' + PASSWORD_MIN + ' 位'); return; }
    if (np !== np2) { setMsg('两次密码不一致'); return; }
    const btn = el('auth-submit');
    btn.disabled = true; setMsg('');
    try {
      await Api.resetPassword(emailValue(), codeValue(), np);
      switchMode('password');
      setMsg('密码已重置，请登录', true);
    } catch (err) { setMsg(shortError(err && err.message)); }
    finally { btn.disabled = false; }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === 'password') startPasswordLogin();
    else if (mode === 'signup') startSignup();
    else if (mode === 'reset') submitReset();
    else submitCodeLogin();
  }

  function init() {
    document.querySelectorAll('#auth-seg .auth-seg-btn').forEach((b) => {
      b.addEventListener('click', () => switchMode(b.dataset.mode));
    });
    el('auth-form').addEventListener('submit', handleSubmit);
    el('auth-get-code').addEventListener('click', onGetCode);
    el('captcha-refresh').addEventListener('click', () => openCaptcha(capAction || 'email-code'));
    el('captcha-canvas').addEventListener('click', onCanvasClick);
    el('captcha-close').addEventListener('click', closeCaptcha);
    el('captcha-modal').addEventListener('click', (e) => {
      if (e.target === el('captcha-modal')) closeCaptcha();  // 点遮罩关闭，不发邮件
    });
    el('auth-forgot').addEventListener('click', () => switchMode('reset'));
    el('auth-switch-btn').addEventListener('click', () => {
      if (mode === 'signup') switchMode(emailVerification ? 'code' : 'password');
      else if (mode === 'reset') switchMode(emailVerification ? 'code' : 'password');
      else switchMode('signup');
    });
    ['auth-password', 'auth-new-password', 'auth-new-password2'].forEach((id) => {
      const i = el(id);
      i.addEventListener('input', () => { i.dataset.dirty = '1'; });
    });
    // 记住密码：只记邮箱，密码交给浏览器密码管理器（autocomplete=current-password）
    try {
      const remembered = localStorage.getItem(REMEMBER_KEY);
      if (remembered) { el('auth-email').value = remembered; el('auth-remember').checked = true; }
    } catch { /* ignore */ }
    el('auth-remember').addEventListener('change', () => {
      try {
        if (!el('auth-remember').checked) localStorage.removeItem(REMEMBER_KEY);
      } catch { /* ignore */ }
    });
    // 先按默认（关闭态）渲染，再异步拉后端开关纠正；接口失败时保持关闭态，开箱即用不受影响
    switchMode('password');
    loadAuthConfig();
    // 无感风控：立刻开始采集行为信号，并在空闲时把 PoW 算好（用户填表的时间足够）
    if (window.BotGuard) BotGuard.start();
    // 浏览器可能在渲染后才自动填充，补一次清理（只清非真人输入的框）
    setTimeout(scrubPasswords, 300);
  }

  async function loadAuthConfig() {
    try {
      const r = await Api.authConfig();
      emailVerification = !!(r && r.data && r.data.emailVerification);
    } catch { emailVerification = false; }
    // 开关确定后按正确的默认模式重渲染：开启→验证码登录，关闭→密码登录。
    // 不能复用当前 mode：init 时还是在关闭态渲染的，mode 已被降级成 password。
    switchMode(emailVerification ? 'code' : 'password');
  }

  async function signOut() {
    try { await Api.logout(); } catch { /* 无状态令牌，忽略 */ }
    Api.setSession(null);
    fire('SIGNED_OUT', null);
  }

  return { init, signOut, getSession, onAuthStateChange };
})();
window.Auth = Auth;
