const { app, BrowserWindow, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const MOVE_INTERVAL_MS = 16;
const DRAG_INTERVAL_MS = 16;
const windowStates = new WeakMap();
let chatWindow = null;
let settingsWindow = null;

function sendState(win, state, direction) {
  if (!win.isDestroyed()) {
    win.webContents.send('pet-state', { state, direction });
  }
}

function sendAction(win, action) {
  if (!win.isDestroyed()) {
    win.webContents.send('pet-action', { action });
  }
}

function sendPaused(win, paused) {
  if (!win.isDestroyed()) {
    win.webContents.send('pet-paused', { paused });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clampTargetX(win, targetX) {
  const bounds = win.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const minX = workArea.x;
  const maxX = workArea.x + workArea.width - bounds.width;
  return Math.max(minX, Math.min(maxX, targetX));
}

function setIgnoreMouseEvents(win, ignore) {
  if (!win.isDestroyed()) {
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }
}

function cancelMovement(state) {
  if (state.movementCancel) {
    state.movementCancel();
    state.movementCancel = null;
  }
}

function isPaused(state) {
  return state.menuPaused || state.dragPaused;
}

function animateWindowX(win, state, fromX, toX, duration) {
  return new Promise((resolve) => {
    if (win.isDestroyed() || fromX === toX) {
      resolve();
      return;
    }

    const y = win.getPosition()[1];
    const startedAt = Date.now();
    let finished = false;
    let timer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      state.movementCancel = null;
      resolve();
    };

    timer = setInterval(() => {
      if (win.isDestroyed()) {
        finish();
        return;
      }

      const elapsed = Date.now() - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const x = Math.round(fromX + (toX - fromX) * easeInOutQuad(progress));
      win.setPosition(x, y);

      if (progress >= 1) {
        finish();
      }
    }, MOVE_INTERVAL_MS);

    state.movementCancel = finish;
  });
}

async function waitWhilePaused(win, state) {
  while (!win.isDestroyed() && isPaused(state)) {
    await delay(50);
  }
}

async function startBehaviorLoop(win, state) {
  const [homeX, homeY] = win.getPosition();
  state.homeX = homeX;
  state.homeY = homeY;
  sendState(win, 'idle', 'right');

  while (!win.isDestroyed()) {
    await waitWhilePaused(win, state);
    if (win.isDestroyed()) return;

    sendState(win, 'idle', 'right');
    await delay(3000 + Math.random() * 3000);
    await waitWhilePaused(win, state);
    if (win.isDestroyed()) return;

    const direction = Math.random() < 0.5 ? 'left' : 'right';
    const distance = 120 + Math.random() * 140;
    const currentX = win.getPosition()[0];
    const targetX = clampTargetX(
      win,
      direction === 'left' ? currentX - distance : currentX + distance
    );

    sendState(win, 'walk', direction);
    await animateWindowX(win, state, currentX, targetX, 900 + Math.random() * 400);
    await waitWhilePaused(win, state);
    if (win.isDestroyed()) return;

    await delay(350);
    await waitWhilePaused(win, state);
    if (win.isDestroyed()) return;

    const returnDirection = direction === 'left' ? 'right' : 'left';
    const returnFromX = win.getPosition()[0];
    sendState(win, 'walk', returnDirection);
    await animateWindowX(win, state, returnFromX, state.homeX, 900 + Math.random() * 400);
    await waitWhilePaused(win, state);
    if (win.isDestroyed()) return;
  }
}

function startDrag(win, state, offset) {
  if (!win || win.isDestroyed() || !state || state.dragTimer) return;

  state.dragPaused = true;
  cancelMovement(state);
  sendState(win, 'idle', 'right');

  state.dragOffsetX = offset.offsetX;
  state.dragOffsetY = offset.offsetY;

  setIgnoreMouseEvents(win, false);

  state.dragTimer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(state.dragTimer);
      state.dragTimer = null;
      return;
    }

    const point = screen.getCursorScreenPoint();
    win.setPosition(
      point.x - state.dragOffsetX,
      point.y - state.dragOffsetY
    );
  }, DRAG_INTERVAL_MS);
}

function endDrag(win, state) {
  if (!win || win.isDestroyed() || !state) return;

  if (state.dragTimer) {
    clearInterval(state.dragTimer);
    state.dragTimer = null;
  }

  const [x, y] = win.getPosition();
  state.homeX = x;
  state.homeY = y;
  state.dragPaused = false;
  setIgnoreMouseEvents(win, false);
}

function togglePause(win, state) {
  state.menuPaused = !state.menuPaused;
  cancelMovement(state);
  sendPaused(win, state.menuPaused);

  if (!state.menuPaused && !state.dragPaused) {
    sendState(win, 'idle', 'right');
  }
}

function greet(win) {
  sendAction(win, 'greet');
}

const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com'
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);

    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model:
        typeof parsed.model === 'string' && parsed.model.trim()
          ? parsed.model.trim()
          : DEFAULT_CONFIG.model,
      baseUrl:
        typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
          ? parsed.baseUrl.trim()
          : DEFAULT_CONFIG.baseUrl
    };
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

async function writeConfig(config) {
  const nextConfig = {
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
    model:
      typeof config.model === 'string' && config.model.trim()
        ? config.model.trim()
        : DEFAULT_CONFIG.model,
    baseUrl:
      typeof config.baseUrl === 'string' && config.baseUrl.trim()
        ? config.baseUrl.trim()
        : DEFAULT_CONFIG.baseUrl
  };

  await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
  await fs.writeFile(
    getConfigPath(),
    JSON.stringify(nextConfig, null, 2),
    'utf8'
  );

  return nextConfig;
}

async function testDeepSeekConnection(config) {
  if (!config.apiKey) {
    const error = new Error('请先填写 API Key');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`连接失败（${response.status}）：${detail}`);
    }

    return true;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('连接超时，请检查网络');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callDeepSeek(config, message) {
  if (!config.apiKey) {
    const error = new Error('请先填写 DeepSeek API Key');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: message }],
      temperature: 0.8,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`请求失败（${response.status}）：${detail}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error('DeepSeek 没有返回内容');
  }

  return content;
}

function openChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 380,
    height: 560,
    minWidth: 340,
    minHeight: 480,
    title: '聊天',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f2f7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'chat-preload.js')
    }
  });

  chatWindow.setMenuBarVisibility(false);
  chatWindow.loadFile('chat.html');

  chatWindow.once('ready-to-show', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.show();
    }
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 500,
    title: '设置',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f2f7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'settings-preload.js')
    }
  });

  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile('settings.html');

  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
    }
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

ipcMain.handle('chat:get-config', async () => {
  return readConfig();
});

ipcMain.handle('chat:save-config', async (_event, config) => {
  try {
    const saved = await writeConfig(config || {});
    return { ok: true, config: saved };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('chat:test-connection', async (_event, config) => {
  try {
    const candidate = {
      apiKey: typeof config?.apiKey === 'string' ? config.apiKey.trim() : '',
      model:
        typeof config?.model === 'string' && config.model.trim()
          ? config.model.trim()
          : DEFAULT_CONFIG.model,
      baseUrl:
        typeof config?.baseUrl === 'string' && config.baseUrl.trim()
          ? config.baseUrl.trim()
          : DEFAULT_CONFIG.baseUrl
    };

    if (!candidate.apiKey) {
      return {
        ok: false,
        message: '请先填写 API Key'
      };
    }

    await testDeepSeekConnection(candidate);
    return {
      ok: true,
      message: '连接成功'
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message || '连接失败'
    };
  }
});

ipcMain.handle('chat:send-message', async (_event, text) => {
  try {
    const config = await readConfig();

    if (!config.apiKey) {
      return {
        ok: false,
        code: 'MISSING_API_KEY',
        message: '请先填写 DeepSeek API Key'
      };
    }

    const content = await callDeepSeek(config, String(text || '').trim());
    return { ok: true, content };
  } catch (error) {
    if (error.code === 'MISSING_API_KEY') {
      return {
        ok: false,
        code: 'MISSING_API_KEY',
        message: error.message
      };
    }

    return {
      ok: false,
      code: 'ERROR',
      message: error.message
    };
  }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  setIgnoreMouseEvents(win, !!ignore);
});

ipcMain.on('drag-start', (event, offset) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowStates.get(win);
  startDrag(win, state, offset || { offsetX: 0, offsetY: 0 });
});

ipcMain.on('drag-end', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowStates.get(win);
  endDrag(win, state);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const state = {
    menuPaused: false,
    dragPaused: false,
    homeX: 0,
    homeY: 0,
    movementCancel: null,
    dragTimer: null,
    dragOffsetX: 0,
    dragOffsetY: 0
  };
  windowStates.set(win, state);

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  win.webContents.on('did-finish-load', () => {
    setIgnoreMouseEvents(win, true);
    startBehaviorLoop(win, state);
  });

  win.webContents.on('context-menu', () => {
    const menu = Menu.buildFromTemplate([
      {
        label: '打招呼',
        click: () => greet(win)
      },
      {
        label: '聊天',
        click: () => openChatWindow()
      },
      {
        label: '设置',
        click: () => openSettingsWindow()
      },
      {
        label: state.menuPaused ? '继续' : '暂停',
        click: () => togglePause(win, state)
      },
      {
        type: 'separator'
      },
      {
        label: '退出',
        click: () => app.quit()
      }
    ]);
    menu.popup({ window: win });
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});



