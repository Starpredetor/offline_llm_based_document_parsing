const apiBase = window.location.origin;

const queryDefaults = {
  top_k: 5,
  temperature: 0.7,
  top_p: 0.9,
  generation_top_k: 40,
  max_tokens: 700,
  frequency_penalty: 0.2,
  presence_penalty: 0.15,
  query_type: "auto",
  output_mode: "auto",
  stream_chunk_chars: 120,
};

const state = {
  currentPage: "dashboard",
  currentProject: "default",
  projects: [],
  documents: [],
  chats: [],
  pendingProjectFiles: [],
  isSending: false,
};

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineMarkdown(line) {
  return escapeHtml(line)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdownTextBlock(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  }

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  return html.join("");
}

function renderMarkdown(text) {
  const raw = String(text || "");
  const blocks = [];
  let cursor = 0;
  const fencePattern = /```[\w-]*\n([\s\S]*?)```/g;
  let match;

  while ((match = fencePattern.exec(raw))) {
    blocks.push({ type: "text", value: raw.slice(cursor, match.index) });
    blocks.push({ type: "code", value: match[1] });
    cursor = match.index + match[0].length;
  }
  blocks.push({ type: "text", value: raw.slice(cursor) });

  return blocks
    .map((block) => block.type === "code" ? `<pre><code>${escapeHtml(block.value)}</code></pre>` : renderMarkdownTextBlock(block.value))
    .join("");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    const detail = payload.detail || payload.message || response.statusText;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return payload;
}

function setStatus(text, variant = "") {
  const pill = byId("status-pill");
  pill.textContent = text;
  pill.className = `status-pill ${variant}`.trim();
}

let toastTimer;
function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function formatDate(seconds) {
  if (!seconds) return "Recently";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(seconds * 1000));
}

function hashFor(page, projectId) {
  if (page === "workspace") {
    return `#/workspace/${encodeURIComponent(projectId || state.currentProject || "default")}`;
  }
  return `#/${page}`;
}

function parseHash() {
  const hash = window.location.hash || "#/dashboard";
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "workspace") return { page: "workspace", projectId: parts[1] || state.currentProject };
  if (parts[0] === "create-project") return { page: "create-project", projectId: state.currentProject };
  return { page: "dashboard", projectId: state.currentProject };
}

function setActivePage(page, projectId = state.currentProject, updateHash = true) {
  state.currentPage = page;
  if (projectId) state.currentProject = projectId;

  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  byId(`view-${page}`)?.classList.add("active");

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === page);
  });

  if (updateHash) {
    const nextHash = hashFor(page, projectId);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }

  updateProjectLabel();
}

function currentProject() {
  return state.projects.find((project) => project.id === state.currentProject);
}

function updateProjectLabel() {
  byId("chat-project-name").textContent = currentProject()?.name || "Default Project";
}

function renderMetricCards(metrics = {}) {
  const items = [
    ["Documents", metrics.uploaded_documents ?? 0],
    ["Projects", metrics.projects ?? state.projects.length],
    ["Chats", metrics.queries ?? 0],
    ["Cache hit", `${metrics.cache_hit_rate ?? 0}%`],
  ];

  byId("dashboard-cards").innerHTML = items
    .map(([label, value]) => `
      <article class="metric-card">
        <div class="metric-label">${escapeHtml(label)}</div>
        <div class="metric-value">${escapeHtml(value)}</div>
      </article>
    `)
    .join("");
}

function renderProjectList(rootId, limit = 12) {
  const root = byId(rootId);
  const projects = [...state.projects].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, limit);

  if (!projects.length) {
    root.innerHTML = "<div class='empty-state'>No projects yet.</div>";
    return;
  }

  root.innerHTML = "";
  projects.forEach((project) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "project-row";
    row.innerHTML = `
      <span>
        <span class="item-title">${escapeHtml(project.name)}</span>
        <span class="item-meta">${formatDate(project.created_at)}</span>
      </span>
    `;
    row.addEventListener("click", () => openProject(project.id));
    root.appendChild(row);
  });
}

function renderRecentChats(chats = []) {
  const root = byId("recent-chats");
  if (!chats.length) {
    root.innerHTML = "<div class='empty-state'>Your recent questions will appear here.</div>";
    return;
  }

  root.innerHTML = "";
  chats.slice(0, 8).forEach((chat) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <span class="item-title">${escapeHtml(chat.query)}</span>
      <span class="item-meta">${formatDate(chat.created_at)} · ${chat.source_count || 0} sources</span>
    `;
    root.appendChild(item);
  });
}

function renderPendingProjectFiles() {
  const root = byId("project-files-preview");
  if (!state.pendingProjectFiles.length) {
    root.innerHTML = "<div class='empty-state'>No files selected.</div>";
    return;
  }

  root.innerHTML = "";
  state.pendingProjectFiles.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "file-row";
    row.innerHTML = `
      <span class="file-main">
        <span class="item-title">${escapeHtml(file.name)}</span>
        <span class="item-meta">${Math.ceil(file.size / 1024)} KB</span>
      </span>
      <button class="button secondary small" type="button" data-remove="${index}">Remove</button>
    `;
    root.appendChild(row);
  });
}

function setPendingFiles(fileList) {
  state.pendingProjectFiles = Array.from(fileList || []);
  renderPendingProjectFiles();
}

async function refreshDashboard() {
  const payload = await fetchJson(`${apiBase}/workspace/dashboard`);
  state.projects = payload.projects || [];
  state.chats = payload.recent_chats || [];

  if (!state.projects.some((project) => project.id === state.currentProject) && state.projects.length) {
    state.currentProject = state.projects[0].id;
  }

  renderMetricCards(payload.metrics);
  renderProjectList("shell-projects", 10);
  renderProjectList("recent-projects", 8);
  renderRecentChats(state.chats);
  updateProjectLabel();
}

async function openProject(projectId) {
  state.currentProject = projectId;
  setActivePage("workspace", projectId);
  await loadProject();
}

async function loadProject() {
  const payload = await fetchJson(`${apiBase}/workspace/projects/${encodeURIComponent(state.currentProject)}`);
  state.documents = payload.documents || [];
  state.chats = payload.recent_chats || [];
  renderDocuments();
  renderProjectChatHistory();
}

async function loadProjectDocuments() {
  const payload = await fetchJson(`${apiBase}/workspace/projects/${encodeURIComponent(state.currentProject)}/documents`);
  state.documents = payload.items || [];
  renderDocuments();
}

function renderDocuments() {
  const root = byId("chat-documents");
  const query = byId("doc-search").value.trim().toLowerCase();
  const docs = query
    ? state.documents.filter((doc) => (doc.filename || "").toLowerCase().includes(query))
    : state.documents;

  if (!docs.length) {
    root.innerHTML = "<div class='empty-state'>No documents found.</div>";
    return;
  }

  root.innerHTML = "";
  docs.slice().reverse().forEach((doc) => {
    const item = document.createElement("div");
    item.className = "file-row";
    item.innerHTML = `
      <span class="file-main">
        <span class="item-title">${escapeHtml(doc.filename)}</span>
        <span class="item-meta">${doc.chunks_added || 0} chunks · ${formatDate(doc.uploaded_at)}</span>
      </span>
      <span class="file-actions">
        <span class="badge">${escapeHtml(doc.status)}</span>
        <button class="button secondary delete-button" type="button" title="Delete document" data-doc-id="${escapeHtml(doc.id)}">×</button>
      </span>
    `;
    root.appendChild(item);
  });
}

function renderSources(sources = []) {
  const root = byId("source-list");
  if (!sources.length) {
    root.innerHTML = "<div class='empty-state'>Sources from the latest answer will appear here.</div>";
    return;
  }

  root.innerHTML = "";
  sources.slice(0, 6).forEach((source, index) => {
    const details = document.createElement("details");
    details.className = "source-card";
    details.open = index === 0;
    details.innerHTML = `
      <summary>${escapeHtml(source.source_file || "Source")} <span class="score">${Number(source.score || 0).toFixed(3)}</span></summary>
      <p>${escapeHtml(source.text || "").slice(0, 650)}</p>
    `;
    root.appendChild(details);
  });
}

function createMessage(role, content) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.innerHTML = `
    <span class="role">${role === "user" ? "You" : "Assistant"}</span>
    <div class="message-content">${renderMarkdown(content || "")}</div>
  `;
  byId("chat-messages").appendChild(message);
  scrollChatToBottom();
  return message.querySelector(".message-content");
}

function renderProjectChatHistory() {
  const root = byId("chat-messages");
  root.innerHTML = "";

  const recent = [...state.chats].reverse().slice(-4);
  if (!recent.length) {
    createMessage("assistant", "Upload documents, then ask a question here.");
    return;
  }

  recent.forEach((chat) => {
    createMessage("user", chat.query || "");
    createMessage("assistant", chat.answer || "");
  });
}

function scrollChatToBottom() {
  const root = byId("chat-messages");
  root.scrollTop = root.scrollHeight;
}

function autoSizeChatInput() {
  const input = byId("chat-input");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

async function createProject(name) {
  const payload = await fetchJson(`${apiBase}/workspace/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return payload.item;
}

async function uploadFiles(projectId, files) {
  const formData = new FormData();
  formData.append("project_id", projectId);
  Array.from(files).forEach((file) => formData.append("files", file));

  const response = await fetch(`${apiBase}/upload`, { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || JSON.stringify(payload));
  return payload;
}

async function sendChat() {
  const input = byId("chat-input");
  const query = input.value.trim();
  if (!query || state.isSending) return;

  state.isSending = true;
  input.disabled = true;
  byId("chat-send-btn").disabled = true;
  setStatus("Thinking", "busy");

  createMessage("user", query);
  input.value = "";
  autoSizeChatInput();
  const answerNode = createMessage("assistant", "Thinking...");

  try {
    const start = await fetchJson(`${apiBase}/query/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...queryDefaults, query, project_id: state.currentProject }),
    });

    let full = "";
    let done = false;
    let sources = [];

    while (!done) {
      const next = await fetchJson(`${apiBase}/query/next/${encodeURIComponent(start.job_id)}?max_chunks=5`);
      if (next.error) throw new Error(next.error);

      full += next.delta || "";
      answerNode.innerHTML = renderMarkdown(full || "Thinking...");
      scrollChatToBottom();

      done = !!next.done;
      if (done) {
        sources = next.sources || [];
      } else {
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    }

    renderSources(sources);
    await refreshDashboard();
    setStatus("Ready", "ok");
  } catch (error) {
    answerNode.innerHTML = renderMarkdown(`Query failed: ${error.message}`);
    setStatus("Error", "error");
    showToast(`Query failed: ${error.message}`);
  } finally {
    state.isSending = false;
    input.disabled = false;
    byId("chat-send-btn").disabled = false;
    input.focus();
  }
}

function initDropZone() {
  const zone = byId("project-drop-zone");
  const input = byId("project-files");

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("dragover");
    });
  });

  zone.addEventListener("drop", (event) => setPendingFiles(event.dataTransfer.files));
  input.addEventListener("change", () => setPendingFiles(input.files));
}

function wireEvents() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const page = button.dataset.view;
      setActivePage(page, state.currentProject);
      if (page === "workspace") await loadProject();
    });
  });

  byId("home-link").addEventListener("click", (event) => {
    event.preventDefault();
    setActivePage("dashboard");
  });
  byId("sidebar-new-project").addEventListener("click", () => setActivePage("create-project"));
  byId("dashboard-create-project").addEventListener("click", () => setActivePage("create-project"));

  byId("project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = byId("project-name").value.trim();
    if (!name) return;

    const submit = byId("project-submit-btn");
    submit.disabled = true;
    setStatus("Creating", "busy");

    try {
      const project = await createProject(name);
      let message = `Created ${project.name}.`;

      if (state.pendingProjectFiles.length) {
        const upload = await uploadFiles(project.id, state.pendingProjectFiles);
        message = `Created ${project.name}. Uploaded ${upload.succeeded}/${upload.total_files} files.`;
      }

      state.pendingProjectFiles = [];
      byId("project-name").value = "";
      byId("project-files").value = "";
      byId("upload-result").textContent = message;
      renderPendingProjectFiles();
      state.currentProject = project.id;
      await refreshDashboard();
      setActivePage("workspace", project.id);
      await loadProject();
      setStatus("Ready", "ok");
      showToast(message);
    } catch (error) {
      byId("upload-result").textContent = error.message;
      setStatus("Error", "error");
      showToast(`Create failed: ${error.message}`);
    } finally {
      submit.disabled = false;
    }
  });

  byId("project-files-preview").addEventListener("click", (event) => {
    const index = event.target.getAttribute("data-remove");
    if (index == null) return;
    state.pendingProjectFiles.splice(Number(index), 1);
    renderPendingProjectFiles();
  });

  byId("clear-project-files").addEventListener("click", () => {
    state.pendingProjectFiles = [];
    byId("project-files").value = "";
    renderPendingProjectFiles();
  });

  byId("chat-upload-btn").addEventListener("click", async () => {
    const input = byId("chat-upload-files");
    if (!input.files || !input.files.length) {
      showToast("Choose files first.");
      return;
    }

    byId("chat-upload-btn").disabled = true;
    setStatus("Uploading", "busy");
    try {
      const upload = await uploadFiles(state.currentProject, input.files);
      input.value = "";
      await refreshDashboard();
      await loadProjectDocuments();
      setStatus("Ready", "ok");
      showToast(`Uploaded ${upload.succeeded}/${upload.total_files} files.`);
    } catch (error) {
      setStatus("Error", "error");
      showToast(`Upload failed: ${error.message}`);
    } finally {
      byId("chat-upload-btn").disabled = false;
    }
  });

  byId("chat-documents").addEventListener("click", async (event) => {
    const docId = event.target.getAttribute("data-doc-id");
    if (!docId) return;
    if (!window.confirm("Delete this document from the project?")) return;

    try {
      await fetchJson(`${apiBase}/workspace/projects/${encodeURIComponent(state.currentProject)}/documents/${encodeURIComponent(docId)}`, {
        method: "DELETE",
      });
      await refreshDashboard();
      await loadProjectDocuments();
      showToast("Document deleted.");
    } catch (error) {
      showToast(`Delete failed: ${error.message}`);
    }
  });

  byId("doc-search").addEventListener("input", renderDocuments);
  byId("chat-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat();
  });
  byId("chat-input").addEventListener("input", autoSizeChatInput);
  byId("chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });

  window.addEventListener("hashchange", async () => {
    const parsed = parseHash();
    setActivePage(parsed.page, parsed.projectId, false);
    if (parsed.page === "workspace") await loadProject();
  });

  initDropZone();
}

async function init() {
  wireEvents();
  renderPendingProjectFiles();
  renderSources();

  try {
    await refreshDashboard();
    const parsed = parseHash();
    setActivePage(parsed.page, parsed.projectId, false);
    if (parsed.page === "workspace") await loadProject();
    setStatus("Ready", "ok");
  } catch (error) {
    setStatus("Offline", "error");
    showToast(`Backend unavailable: ${error.message}`);
  }
}

init();
