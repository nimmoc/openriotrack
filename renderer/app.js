const state = {
  snapshot: null,
  selected: new Set(),
  query: '',
  memoryId: 0,
  busy: false,
  polling: false,
  platform: null
};

const CONNECTION_POLL_MS = 2000;

const elements = {};
let dragDepth = 0;

function $(id) { return document.getElementById(id); }

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatSize(kib) {
  return kib >= 1024 ? `${(kib / 1024).toFixed(1)} MB` : `${kib} KB`;
}

function memoryLabel(memoryId) {
  const memory = state.snapshot?.device?.memories?.find((item) => item.id === memoryId);
  if (!memory) return `存储 ${memoryId + 1}`;
  return memoryId === 0 ? '内部' : '扩展卡';
}

function setLoading() {
  state.busy = true;
  elements.statusDot.className = 'status-dot status-loading';
  elements.deviceTitle.textContent = '正在连接';
  elements.deviceMeta.textContent = '正在读取 Rio 800 信息';
  elements.connectionLabel.textContent = '正在检查设备';
  elements.contentState.className = 'content-state loading-state';
  elements.contentState.innerHTML = '<div class="spinner" aria-hidden="true"></div><strong>正在读取设备</strong><span>这通常只需要几秒钟</span>';
  elements.contentState.classList.remove('is-hidden');
  elements.tableWrap.classList.add('is-hidden');
  updateControls();
}

function renderDisconnected(snapshot) {
  const permission = snapshot.state === 'permission';
  const error = snapshot.state === 'error';
  const dataTimeout = snapshot.code === 'data-channel-timeout';
  const icon = permission ? 'shield-alert' : error ? 'circle-alert' : 'usb';
  const title = permission ? 'USB 访问受限' : dataTimeout ? '数据通道无响应' : error ? '无法读取设备' : '未连接 Rio 800';
  const action = state.platform?.platform === 'win32' && permission
    ? '<button id="inlineDriverButton" class="button button-quiet" type="button"><i data-lucide="shield-check" aria-hidden="true"></i>查看驱动说明</button>'
    : '';

  elements.statusDot.className = `status-dot ${error || permission ? 'status-error' : 'status-disconnected'}`;
  elements.deviceGlyph.classList.add('disconnected');
  elements.deviceTitle.textContent = title;
  elements.deviceMeta.textContent = snapshot.message;
  elements.connectionLabel.textContent = title;
  elements.capacityText.textContent = '--';
  elements.capacityBar.style.width = '0%';
  elements.trackCount.textContent = '0 首';
  elements.selectionSummary.classList.add('is-hidden');
  elements.contentState.className = 'content-state';
  elements.contentState.innerHTML = `<i class="state-icon" data-lucide="${icon}" aria-hidden="true"></i><strong>${title}</strong><span>${snapshot.message}</span>${action}`;
  elements.contentState.classList.remove('is-hidden');
  elements.tableWrap.classList.add('is-hidden');
  elements.footerStatus.textContent = snapshot.message;
  lucide.createIcons();
  $('inlineDriverButton')?.addEventListener('click', () => window.rio.openDriverGuide());
}

function renderDevice() {
  const { device, tracks } = state.snapshot;
  const total = device.memories.reduce((sum, memory) => sum + memory.totalMiB, 0);
  const used = device.memories.reduce((sum, memory) => sum + memory.usedMiB, 0);
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  elements.statusDot.className = 'status-dot status-connected';
  elements.deviceGlyph.classList.remove('disconnected');
  elements.deviceTitle.textContent = device.name || 'Rio 800';
  elements.deviceMeta.textContent = [device.firmware && `固件 ${device.firmware}`, device.serial && `序列号 ${device.serial.slice(-8).toUpperCase()}`].filter(Boolean).join('  ·  ') || '已连接';
  elements.connectionLabel.textContent = '设备已连接';
  elements.capacityText.textContent = `总计 ${used.toFixed(1)} MB 已用 / ${total.toFixed(1)} MB`;
  elements.capacityBar.style.width = `${percent}%`;
  elements.footerStatus.textContent = `已连接 ${device.name || 'Rio 800'}`;

  elements.memorySelect.innerHTML = device.memories.map((memory) => {
    const label = memory.id === 0 ? '内部' : '扩展卡';
    return `<option value="${memory.id}">${label} 总${memory.totalMiB.toFixed(1)} · 余${memory.freeMiB.toFixed(1)} MB</option>`;
  }).join('');

  if (!device.memories.some((memory) => memory.id === state.memoryId)) {
    state.memoryId = device.memories[0]?.id ?? 0;
  }
  elements.memorySelect.value = String(state.memoryId);

  renderTracks();
}

function filteredTracks() {
  const query = state.query.trim().toLocaleLowerCase();
  const memoryTracks = (state.snapshot?.tracks || []).filter((track) => track.memoryId === state.memoryId);
  if (!query) return memoryTracks;
  return memoryTracks.filter((track) => [track.title, track.artist, track.album, track.filename]
    .some((value) => value?.toLocaleLowerCase().includes(query)));
}

function trackKey(track) { return `${track.memoryId}:${track.id}`; }

function renderTracks() {
  const tracks = filteredTracks();
  const memoryTrackCount = state.snapshot.tracks.filter((track) => track.memoryId === state.memoryId).length;
  elements.trackCount.textContent = state.query.trim() ? `${tracks.length} / ${memoryTrackCount} 首` : `${tracks.length} 首`;
  updateSelectionSummary();

  if (state.snapshot.tracks.length === 0) {
    elements.contentState.className = 'content-state';
    elements.contentState.innerHTML = '<i class="state-icon" data-lucide="music-2" aria-hidden="true"></i><strong>设备中还没有音乐</strong><span>使用“添加音乐”选择 MP3、WMA 或 WAV 文件。</span>';
    elements.contentState.classList.remove('is-hidden');
    elements.tableWrap.classList.add('is-hidden');
    lucide.createIcons();
    return;
  }

  if (tracks.length === 0) {
    const searching = state.query.trim().length > 0;
    elements.contentState.className = 'content-state';
    elements.contentState.innerHTML = searching
      ? '<i class="state-icon" data-lucide="search-x" aria-hidden="true"></i><strong>没有找到歌曲</strong><span>请更换搜索内容。</span>'
      : '<i class="state-icon" data-lucide="music-2" aria-hidden="true"></i><strong>当前存储中没有音乐</strong><span>可以将音乐添加到这个存储区。</span>';
    elements.contentState.classList.remove('is-hidden');
    elements.tableWrap.classList.add('is-hidden');
    lucide.createIcons();
    return;
  }

  elements.contentState.classList.add('is-hidden');
  elements.tableWrap.classList.remove('is-hidden');
  elements.trackRows.innerHTML = tracks.map((track) => {
    const key = trackKey(track);
    const selected = state.selected.has(key);
    return `<tr class="${selected ? 'selected' : ''}" data-key="${key}">
      <td class="select-column"><input type="checkbox" aria-label="选择 ${escapeHtml(track.title)}" ${selected ? 'checked' : ''}></td>
      <td><div class="track-title">${escapeHtml(track.title || track.filename)}</div><div class="track-subtitle">${escapeHtml(track.filename)}</div></td>
      <td>${escapeHtml(track.artist || '未知艺人')}</td>
      <td>${escapeHtml(track.album || '未知专辑')}</td>
      <td>${formatDuration(track.duration)}</td>
      <td>${formatSize(track.sizeKiB)}</td>
      <td>${memoryLabel(track.memoryId)}</td>
    </tr>`;
  }).join('');

  elements.trackRows.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const checkbox = row.querySelector('input');
      checkbox.checked = !checkbox.checked;
      toggleSelection(row.dataset.key, checkbox.checked);
    });
    row.querySelector('input').addEventListener('change', (event) => toggleSelection(row.dataset.key, event.target.checked));
  });

  const visibleKeys = tracks.map(trackKey);
  elements.selectAll.checked = visibleKeys.length > 0 && visibleKeys.every((key) => state.selected.has(key));
  elements.selectAll.indeterminate = visibleKeys.some((key) => state.selected.has(key)) && !elements.selectAll.checked;
  updateControls();
}

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = value || '';
  return span.innerHTML;
}

function toggleSelection(key, selected) {
  if (selected) state.selected.add(key);
  else state.selected.delete(key);
  renderTracks();
}

function updateSelectionSummary() {
  const tracks = selectedTracks();
  if (tracks.length === 0) {
    elements.selectionSummary.classList.add('is-hidden');
    elements.selectionSummary.textContent = '';
    return;
  }

  const totalKiB = tracks.reduce((sum, track) => sum + track.sizeKiB, 0);
  elements.selectionSummary.textContent = `已选 ${tracks.length} 首 · ${formatSize(totalKiB)}`;
  elements.selectionSummary.classList.remove('is-hidden');
}

function updateControls() {
  const connected = state.snapshot?.state === 'connected';
  elements.addButton.disabled = !connected || state.busy;
  elements.deleteButton.disabled = !connected || state.busy || state.selected.size === 0;
  elements.memorySelect.disabled = !connected || state.busy;
  elements.refreshButton.disabled = state.busy;
  elements.searchInput.disabled = !connected;
}

async function refresh({ force = false } = {}) {
  setLoading();
  const snapshot = await window.rio.getSnapshot({ force });
  state.snapshot = snapshot;
  state.selected.clear();
  state.busy = false;
  if (snapshot.state === 'connected') renderDevice();
  else renderDisconnected(snapshot);
  updateControls();
}

async function pollConnection() {
  if (state.busy || state.polling || document.hidden) return;
  state.polling = true;

  try {
    const probe = await window.rio.probe();
    const previousState = state.snapshot?.state;

    if (probe.state === 'connected' && previousState !== 'connected') {
      await refresh();
    } else if (probe.state !== 'connected' && probe.state !== 'busy'
      && (previousState !== probe.state || state.snapshot?.message !== probe.message)) {
      state.snapshot = probe;
      state.selected.clear();
      renderDisconnected(probe);
      updateControls();
    }
  } finally {
    state.polling = false;
  }
}

function supportedAudioFiles(files) {
  return files.filter((file) => /\.(mp3|wma|wav)$/i.test(file));
}

async function uploadFiles(requestedFiles) {
  const files = supportedAudioFiles(requestedFiles);
  if (files.length === 0) {
    elements.footerStatus.textContent = '请选择 MP3、WMA 或 WAV 音频文件。';
    return;
  }
  if (state.snapshot?.state !== 'connected' || state.busy) return;

  if (!files.length) return;
  state.busy = true;
  updateControls();
  showProgress({ type: 'upload', index: 0, total: files.length, file: files[0], status: 'running' });
  const result = await window.rio.upload({ files, memoryId: state.memoryId });
  if (!result.ok) elements.footerStatus.textContent = result.message;
  state.busy = false;
  if (result.ok && result.snapshot?.state === 'connected') {
    state.snapshot = result.snapshot;
    state.selected.clear();
    renderDevice();
    updateControls();
  } else {
    await refresh();
  }
}

async function addMusic() {
  const files = await window.rio.chooseFiles();
  await uploadFiles(files);
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function setDropActive(active) {
  document.body.classList.toggle('is-dragging', active);
  elements.dropOverlay.setAttribute('aria-hidden', String(!active));
  if (active) elements.dropTarget.textContent = `添加到${memoryLabel(state.memoryId)}`;
}

function handleDragEnter(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  if (state.snapshot?.state === 'connected' && !state.busy) setDropActive(true);
}

function handleDragOver(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = state.snapshot?.state === 'connected' && !state.busy ? 'copy' : 'none';
}

function handleDragLeave(event) {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDropActive(false);
}

async function handleDrop(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  setDropActive(false);

  if (state.snapshot?.state !== 'connected' || state.busy) return;
  const paths = Array.from(event.dataTransfer.files)
    .map((file) => window.rio.getPathForFile(file))
    .filter(Boolean);
  await uploadFiles(paths);
}

function selectedTracks() {
  return (state.snapshot?.tracks || []).filter((track) => state.selected.has(trackKey(track)));
}

async function deleteSelected() {
  const tracks = selectedTracks();
  if (!tracks.length) return;
  elements.confirmText.textContent = `将从 Rio 800 中删除 ${tracks.length} 首歌曲。此操作无法撤销。`;
  elements.confirmDialog.showModal();
}

async function confirmDelete() {
  const tracks = selectedTracks();
  state.busy = true;
  updateControls();
  showProgress({ type: 'delete', index: 0, total: tracks.length, file: tracks[0]?.title, status: 'running' });
  const result = await window.rio.deleteTracks({ tracks });
  if (!result.ok) elements.footerStatus.textContent = result.message;
  state.busy = false;
  if (result.ok && result.snapshot?.state === 'connected') {
    state.snapshot = result.snapshot;
    state.selected.clear();
    renderDevice();
    updateControls();
  } else {
    await refresh();
  }
}

function showProgress(progress) {
  const deleting = progress.type === 'delete';
  if (progress.status === 'complete') {
    elements.progressTitle.textContent = deleting ? '删除完成' : '传输完成';
    elements.progressDetail.textContent = `${progress.total} 首歌曲`;
    elements.progressBar.style.width = '100%';
    setTimeout(() => elements.progressPanel.classList.add('is-hidden'), 1200);
    return;
  }
  if (progress.status === 'error') {
    elements.progressTitle.textContent = deleting ? '删除失败' : '传输失败';
    elements.progressDetail.textContent = progress.message;
    return;
  }
  elements.progressPanel.classList.remove('is-hidden');
  elements.progressTitle.textContent = deleting ? '正在删除歌曲' : '正在传输音乐';
  const percent = progress.total ? Math.round((progress.index / progress.total) * 100) : 0;
  elements.progressDetail.textContent = progress.file ? `${progress.file} · ${percent}%` : `${percent}%`;
  elements.progressBar.style.width = `${percent}%`;
}

async function init() {
  Object.assign(elements, {
    addButton: $('addButton'),
    cancelButton: $('cancelButton'),
    capacityBar: $('capacityBar'),
    capacityText: $('capacityText'),
    confirmDeleteButton: $('confirmDeleteButton'),
    confirmDialog: $('confirmDialog'),
    confirmText: $('confirmText'),
    connectionLabel: $('connectionLabel'),
    contentState: $('contentState'),
    deleteButton: $('deleteButton'),
    deviceGlyph: $('deviceGlyph'),
    deviceMeta: $('deviceMeta'),
    deviceTitle: $('deviceTitle'),
    driverButton: $('driverButton'),
    dropOverlay: $('dropOverlay'),
    dropTarget: $('dropTarget'),
    footerStatus: $('footerStatus'),
    memorySelect: $('memorySelect'),
    platformLabel: $('platformLabel'),
    progressBar: $('progressBar'),
    progressDetail: $('progressDetail'),
    progressPanel: $('progressPanel'),
    progressTitle: $('progressTitle'),
    refreshButton: $('refreshButton'),
    searchInput: $('searchInput'),
    selectAll: $('selectAll'),
    selectionSummary: $('selectionSummary'),
    statusDot: $('statusDot'),
    tableWrap: $('tableWrap'),
    trackCount: $('trackCount'),
    trackRows: $('trackRows')
  });

  lucide.createIcons();
  state.platform = await window.rio.getPlatform();
  const platformName = state.platform.platform === 'darwin' ? 'macOS' : state.platform.platform === 'win32' ? 'Windows' : state.platform.platform;
  const displayVersion = state.platform.version === '1.0.0' ? '1.0' : state.platform.version;
  elements.platformLabel.textContent = `OpenRioTrack ${displayVersion} · by nimmoc · ${platformName} ${state.platform.arch}${state.platform.demo ? ' · 演示数据' : ''}`;
  elements.driverButton.classList.toggle('is-hidden', state.platform.platform !== 'win32');

  elements.refreshButton.addEventListener('click', () => refresh({ force: true }));
  elements.addButton.addEventListener('click', addMusic);
  elements.deleteButton.addEventListener('click', deleteSelected);
  elements.confirmDeleteButton.addEventListener('click', confirmDelete);
  elements.driverButton.addEventListener('click', () => window.rio.openDriverGuide());
  elements.cancelButton.addEventListener('click', async () => {
    await window.rio.cancel();
    elements.progressPanel.classList.add('is-hidden');
    state.busy = false;
    await refresh();
  });
  elements.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderTracks();
  });
  elements.memorySelect.addEventListener('change', (event) => {
    state.memoryId = Number.parseInt(event.target.value, 10);
    state.selected.clear();
    renderTracks();
  });
  elements.selectAll.addEventListener('change', (event) => {
    filteredTracks().forEach((track) => {
      const key = trackKey(track);
      if (event.target.checked) state.selected.add(key);
      else state.selected.delete(key);
    });
    renderTracks();
  });
  document.addEventListener('dragenter', handleDragEnter);
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('dragleave', handleDragLeave);
  document.addEventListener('drop', handleDrop);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollConnection();
  });
  window.rio.onProgress(showProgress);

  await refresh();
  window.setInterval(pollConnection, CONNECTION_POLL_MS);
}

window.addEventListener('DOMContentLoaded', init, { once: true });
