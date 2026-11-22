// api.js —— 与本地后端 REST 通信（同源，无需跨域）
// 约定：所有响应体为 { data: ... } 或 { error: '消息' }
const Api = (function () {
  const BASE = '';

  // 令牌只存 sessionStorage：关闭浏览器/标签页即失效（配合服务端 2 小时有效期，双保险）。
  // 不用 localStorage，避免几天不访问后仍处于登录态。
  function token() { return sessionStorage.getItem('hvt_token'); }
  function setSession(tok, user) {
    if (tok) {
      sessionStorage.setItem('hvt_token', tok);
      sessionStorage.setItem('hvt_user', JSON.stringify(user || null));
    } else {
      sessionStorage.removeItem('hvt_token');
      sessionStorage.removeItem('hvt_user');
    }
  }
  function currentUser() {
    const u = sessionStorage.getItem('hvt_user');
    try { return u ? JSON.parse(u) : null; } catch { return null; }
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const tk = token();
    if (tk) headers['Authorization'] = 'Bearer ' + tk;
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      // 网络层错误（后端没起来等）
      throw new Error('无法连接服务器：请确认 npm start 已运行（本地后端默认 http://127.0.0.1:8787）');
    }
    let data = null;
    try { data = await res.json(); } catch { /* 可能无响应体 */ }
    if (!res.ok) {
      // 会话失效：携带令牌却返回 401（未登录/过期）→ 清本地会话并通知界面回登录页。
      // 登录接口本身不带令牌，其 401（密码错误）不满足 tk 条件，不会误触发退出。
      if (res.status === 401 && tk) {
        setSession(null);
        try { window.dispatchEvent(new CustomEvent('hvt:unauthorized')); } catch (e) {}
      }
      const msg = (data && data.error) ? data.error : ('请求失败（HTTP ' + res.status + '）');
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return data;
  }

  return {
    setSession, token, currentUser,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    del: (p) => request('DELETE', p),
    captcha: () => request('GET', '/api/auth/captcha'),
    // 非敏感登录配置：邮箱验证码是否启用（决定登录页显示哪套表单）
    authConfig: () => request('GET', '/api/auth/config'),
    // 图形验证码正确后，由服务端发送邮箱验证码（注册 / 登录 / 找回密码共用）
    emailCode: (email, purpose, cap) => request('POST', '/api/auth/email-code', {
      email, purpose, captchaId: cap && cap.id, captchaAnswer: cap && cap.answer
    }),
    // 邮箱验证开启时传 emailCode；关闭时传图形验证码 cap（后端二选一校验）
    register: (email, password, emailCode, cap) => request('POST', '/api/auth/register', {
      email, password, emailCode,
      captchaId: cap && cap.id, captchaAnswer: cap && cap.answer
    }),
    // 密码登录：每次都必须携带一次性图形验证码结果（前端先弹窗，答对后才提交）；
    // 缺 cap 直接本地拒绝，不发裸登录请求
    login: (email, password, cap) => {
      if (!cap || !cap.id) return Promise.reject(new Error('请先完成安全验证'));
      return request('POST', '/api/auth/login', {
        email, password, captchaId: cap.id, captchaAnswer: cap.answer
      });
    },
    // 验证码登录：邮箱 + 一次性邮箱码，免密
    loginByCode: (email, emailCode) => request('POST', '/api/auth/login-code', { email, emailCode }),
    resetPassword: (email, emailCode, newPassword) => request('POST', '/api/auth/reset-password', { email, emailCode, newPassword }),
    changePassword: (oldPassword, newPassword) => request('POST', '/api/auth/change-password', { oldPassword, newPassword }),
    me: () => request('GET', '/api/auth/me'),
    updateProfile: (p) => request('PATCH', '/api/auth/me', p),
    logout: () => request('POST', '/api/auth/logout'),
    // 文件上传：直接以二进制流式上传（body 为 File/Blob），不转 base64，避免大文件（视频）撑爆内存
    uploadFile: async (path, file, key, filename) => {
      const headers = {};
      const tk = token();
      if (tk) headers['Authorization'] = 'Bearer ' + tk;
      if (filename) headers['x-filename'] = encodeURIComponent(filename);
      if (key) headers['x-key'] = key;
      let res;
      try {
        res = await fetch(BASE + path, { method: 'POST', headers, body: file });
      } catch (e) {
        throw new Error('无法连接服务器：请确认 npm start 已运行（本地后端默认 http://127.0.0.1:8787）');
      }
      let data = null;
      try { data = await res.json(); } catch (e) { /* 可能无响应体 */ }
      if (!res.ok) {
        const msg = (data && data.error) ? data.error : ('上传失败（HTTP ' + res.status + '）');
        throw new Error(msg);
      }
      return data;
    }
  };
})();
window.Api = Api;
