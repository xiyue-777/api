// workers.js - 简化版 KV 存储方案
export default {
  async fetch(request, env, ctx) {
    // CORS 处理
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 从 KV 获取数据的辅助函数
    async function getFromKV(key) {
      const data = await env.CHAT_DATA.get(key);
      return data ? JSON.parse(data) : null;
    }
    
    // 保存到 KV 的辅助函数
    async function saveToKV(key, value) {
      await env.CHAT_DATA.put(key, JSON.stringify(value));
    }
    
    // 初始化管理员账户
    async function initAdmin() {
      const admin = await getFromKV('user:xiyue');
      if (!admin) {
        await saveToKV('user:xiyue', {
          username: 'xiyue',
          password: '20090327qi',
          nickname: '管理员',
          avatar: 'https://i.pravatar.cc/150?u=admin',
          isAdmin: true,
          createdAt: new Date().toISOString()
        });
        console.log('管理员账户已创建');
      }
    }
    
    // 初始化系统设置
    async function initSettings() {
      const settings = await getFromKV('settings');
      if (!settings) {
        await saveToKV('settings', {
          autoClearTime: 0, // 0 = 永不自动清除
          lastClearTime: new Date().toISOString()
        });
        console.log('系统设置已初始化');
      }
    }
    
    // 邀请码 (不区分大小写)
    const INVITE_CODE = 'xiyue520';
    
    try {
      // 初始化
      await initAdmin();
      await initSettings();
      
      // 注册
      if (path === '/register' && request.method === 'POST') {
        const { username, password, nickname, avatar, inviteCode } = await request.json();
        
        // 验证字段
        if (!username || !password || !nickname || !avatar || !inviteCode) {
          return new Response(JSON.stringify({ error: '请填写所有字段' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 验证邀请码
        if (inviteCode.toLowerCase() !== INVITE_CODE.toLowerCase()) {
          return new Response(JSON.stringify({ error: '无效的邀请码' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 检查用户名是否已存在
        const existingUser = await getFromKV(`user:${username}`);
        if (existingUser) {
          return new Response(JSON.stringify({ error: '用户名已存在' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 创建用户
        await saveToKV(`user:${username}`, {
          username,
          password,
          nickname,
          avatar,
          isAdmin: false,
          createdAt: new Date().toISOString()
        });
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 登录
      else if (path === '/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        
        const user = await getFromKV(`user:${username}`);
        if (!user || user.password !== password) {
          return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 创建不含密码的用户信息
        const userInfo = {
          username: user.username,
          nickname: user.nickname,
          avatar: user.avatar,
          isAdmin: user.isAdmin
        };
        
        return new Response(JSON.stringify({ user: userInfo }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 获取消息
      else if (path === '/messages' && request.method === 'GET') {
        const messages = await getFromKV('messages') || [];
        return new Response(JSON.stringify(messages), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 发送消息
      else if (path === '/send' && request.method === 'POST') {
        const { username, message } = await request.json();
        
        // 检查是否被禁言
        const mutedUsers = await getFromKV('muted_users') || [];
        if (mutedUsers.includes(username)) {
          return new Response(JSON.stringify({ error: '您已被禁言，无法发送消息' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 获取现有消息
        let messages = await getFromKV('messages') || [];
        
        // 添加新消息
        messages.push({
          username,
          message,
          timestamp: new Date().toISOString()
        });
        
        // 限制消息数量（保留最近100条）
        if (messages.length > 100) {
          messages = messages.slice(-100);
        }
        
        await saveToKV('messages', messages);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 获取用户列表 (管理员)
      else if (path === '/user-list' && request.method === 'GET') {
        // 简单验证是否为管理员 - 实际应用中应该有更严格的验证
        const users = [];
        let cursor = null;
        
        // 获取所有用户
        do {
          const listResult = await env.CHAT_DATA.list({ prefix: 'user:', cursor });
          
          for (const key of listResult.keys) {
            const userData = await getFromKV(key.name);
            if (userData) {
              users.push({
                username: userData.username,
                nickname: userData.nickname,
                avatar: userData.avatar,
                isAdmin: userData.isAdmin
              });
            }
          }
          
          cursor = listResult.cursor;
        } while (cursor);
        
        // 获取禁言列表
        const mutedUsers = await getFromKV('muted_users') || [];
        
        // 添加禁言状态
        const usersWithMuteStatus = users.map(user => ({
          ...user,
          isMuted: mutedUsers.includes(user.username)
        }));
        
        return new Response(JSON.stringify(usersWithMuteStatus), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 禁言用户
      else if (path === '/mute' && request.method === 'POST') {
        const { username } = await request.json();
        
        // 不能禁言管理员
        if (username === 'xiyue') {
          return new Response(JSON.stringify({ error: '不能禁言管理员' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        let mutedUsers = await getFromKV('muted_users') || [];
        
        // 检查用户是否已存在
        const user = await getFromKV(`user:${username}`);
        if (!user) {
          return new Response(JSON.stringify({ error: '用户不存在' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 添加到禁言列表
        if (!mutedUsers.includes(username)) {
          mutedUsers.push(username);
          await saveToKV('muted_users', mutedUsers);
        }
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 解禁用户
      else if (path === '/unmute' && request.method === 'POST') {
        const { username } = await request.json();
        
        let mutedUsers = await getFromKV('muted_users') || [];
        
        // 从禁言列表中移除
        mutedUsers = mutedUsers.filter(u => u !== username);
        await saveToKV('muted_users', mutedUsers);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 获取禁言列表
      else if (path === '/get-mute-list' && request.method === 'GET') {
        const mutedUsers = await getFromKV('muted_users') || [];
        return new Response(JSON.stringify({ users: mutedUsers }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 获取自动清除时间
      else if (path === '/get-clear-time' && request.method === 'GET') {
        const settings = await getFromKV('settings');
        const autoClearTime = settings ? settings.autoClearTime : 0;
        
        return new Response(JSON.stringify({ time: autoClearTime.toString() }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 设置自动清除时间
      else if (path === '/set-clear-time' && request.method === 'POST') {
        const { time } = await request.json();
        
        const settings = await getFromKV('settings');
        if (!settings) {
          return new Response(JSON.stringify({ error: '设置不存在' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        settings.autoClearTime = parseInt(time);
        settings.lastClearTime = new Date().toISOString();
        await saveToKV('settings', settings);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 清除所有消息
      else if (path === '/clear-messages' && request.method === 'POST') {
        await saveToKV('messages', []);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 移除用户
      else if (path === '/remove' && request.method === 'POST') {
        const { username } = await request.json();
        
        // 不能移除管理员
        if (username === 'xiyue') {
          return new Response(JSON.stringify({ error: '不能移除管理员' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 检查用户是否存在
        const user = await getFromKV(`user:${username}`);
        if (!user) {
          return new Response(JSON.stringify({ error: '用户不存在' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // 从 KV 中删除用户
        await env.CHAT_DATA.delete(`user:${username}`);
        
        // 从禁言列表中移除（如果存在）
        let mutedUsers = await getFromKV('muted_users') || [];
        mutedUsers = mutedUsers.filter(u => u !== username);
        await saveToKV('muted_users', mutedUsers);
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // 404
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
  
  // 定时触发器 - 检查是否需要清除消息
  async scheduled(event, env, ctx) {
    try {
      // 获取设置
      const settingsData = await env.CHAT_DATA.get('settings');
      if (!settingsData) return;
      
      const settings = JSON.parse(settingsData);
      const autoClearTime = parseInt(settings.autoClearTime);
      
      if (autoClearTime <= 0) return; // 不需要自动清除
      
      // 检查是否已到清除时间
      const lastClearTime = new Date(settings.lastClearTime);
      const now = new Date();
      
      if (now - lastClearTime < autoClearTime) return; // 还没到清除时间
      
      console.log('自动清除旧消息');
      
      // 清除消息
      await env.CHAT_DATA.put('messages', JSON.stringify([]));
      
      // 更新最后清除时间
      settings.lastClearTime = now.toISOString();
      await env.CHAT_DATA.put('settings', JSON.stringify(settings));
      
    } catch (error) {
      console.error('定时任务错误:', error);
    }
  }
};