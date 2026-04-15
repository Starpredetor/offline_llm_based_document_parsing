const apiBase = window.location.origin;

const state = {
  currentPage: "dashboard",
  currentProject: "default",
  projects: [],
  documents: [],
  chats: [],
  pendingProjectFiles: [],
  ui: {
    sidebarOpen: false,
    leftPanelOpen: true,
    rightPanelOpen: false,
  },
};

function byId(id) {
  return document.getElementById(id);
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  return resp.json();
}

function hashFor(page, projectId) {
  if (page === "workspace") {
    return `#/workspace/${projectId || state.currentProject || "default"}`;
  }
  return `#/${page}`;
}

function parseHash() {
  const hash = window.location.hash || "#/dashboard";
  const clean = hash.replace(/^#\/?/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts[0] === "workspace") {
    return { page: "workspace", projectId: parts[1] || state.currentProject || "default" };
  }
  if (parts[0] === "create-project") {
    return { page: "create-project", projectId: state.currentProject };
  }
  return { page: "dashboard", projectId: state.currentProject };
}

function setActivePage(page, projectId = state.currentProject, updateHash = true) {
  state.currentPage = page;
  if (projectId) {
    state.currentProject = projectId;
  }

  document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
  const target = byId(`view-${page}`);
  if (target) {
    target.classList.add("active");
  }

  document.querySelectorAll(".tab-btn").forEach((el) => el.classList.remove("active"));
  const activeTab = document.querySelector(`.tab-btn[data-view='${page}']`);
  if (activeTab) {
    activeTab.classList.add("active");
  }

  if (updateHash) {
    const nextHash = hashFor(page, projectId);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  updateProjectLabel();
}

function updateProjectLabel() {
  const project = state.projects.find((item) => item.id === state.currentProject);
  byId("chat-project-name").textContent = project ? `Project: ${project.name}` : "Project: Default";
}

function renderSidebarProjects() {
  const root = byId("shell-projects");
  root.innerHTML = "";

  const items = [...state.projects]
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 14);

  items.forEach((project) => {
    const row = document.createElement("div");
    row.className = "file";
    row.innerHTML = `<span>${project.name}</span><span class='badge'>•</span>`;
    row.onclick = async () => {
      state.currentProject = project.id;
      setActivePage("workspace", project.id);
      await loadProjectDocuments();
    };
    root.appendChild(row);
  });
}

function renderMetricsCards(metrics) {
  const cards = byId("dashboard-cards");
  cards.innerHTML = "";
  const items = [
    ["Total Docs", metrics.uploaded_documents],
    ["Projects", metrics.projects],
    ["Chats", metrics.queries],
    ["Usage", `${metrics.cache_hit_rate}% cache`],
  ];

  items.forEach(([k, v]) => {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<div class='muted'>${k}</div><div><strong>${v}</strong></div>`;
    cards.appendChild(el);
  });
}

function renderRecentProjects() {
  const root = byId("recent-projects");
  root.innerHTML = "";

  const nonDefaultProjects = state.projects.filter((p) => p.id !== "default");
  const recent = [...nonDefaultProjects]
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 6);

  if (!recent.length) {
    root.innerHTML = "<div class='muted'>nothing to see here</div>";
    return;
  }

  recent.forEach((project) => {
    const item = document.createElement("div");
    item.className = "item";
    item.textContent = `- ${project.name}`;
    root.appendChild(item);
  });
}

function renderRecentChats(chats) {
  const root = byId("recent-chats");
  root.innerHTML = "";
  if (!chats.length) {
    root.innerHTML = "<div class='muted'>No recent chats.</div>";
    return;
  }

  chats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "item";
    item.textContent = `- ${chat.query}`;
    root.appendChild(item);
  });
}

function renderPendingProjectFiles() {
  const root = byId("project-files-preview");
  root.innerHTML = "";

  if (!state.pendingProjectFiles.length) {
    root.innerHTML = "<div class='muted'>No files selected.</div>";
    return;
  }

  state.pendingProjectFiles.forEach((file, idx) => {
    const row = document.createElement("div");
    row.className = "file";
    row.innerHTML = `<span>${file.name}</span><button class='button ghost' data-remove='${idx}'>Remove</button>`;
    root.appendChild(row);
  });
}

function setPendingFiles(fileList) {
  state.pendingProjectFiles = Array.from(fileList || []);
  renderPendingProjectFiles();
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
  const fd = new FormData();
  fd.append("project_id", projectId);
  Array.from(files).forEach((f) => fd.append("files", f));

  const resp = await fetch(`${apiBase}/upload`, {
    method: "POST",
    body: fd,
  });
  const payload = await resp.json();
  if (!resp.ok) {
    throw new Error(JSON.stringify(payload));
  }
  return payload;
}

async function deleteDocument(projectId, documentId) {
  await fetchJson(`${apiBase}/workspace/projects/${projectId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

async function refreshDashboard() {
  const payload = await fetchJson(`${apiBase}/workspace/dashboard`);
  state.projects = payload.projects || [];
  state.chats = payload.recent_chats || [];

  if (!state.projects.some((p) => p.id === state.currentProject) && state.projects.length) {
    state.currentProject = state.projects[0].id;
  }

  renderMetricsCards(payload.metrics);
  renderRecentProjects();
  renderRecentChats(state.chats);
  renderSidebarProjects();
  updateProjectLabel();
}

async function loadProjectDocuments() {
  const payload = await fetchJson(`${apiBase}/workspace/projects/${state.currentProject}/documents`);
  state.documents = payload.items || [];

  const container = byId("chat-documents");
  container.innerHTML = "";
  const query = (byId("doc-search").value || "").trim().toLowerCase();
  const filtered = query
    ? state.documents.filter((d) => (d.filename || "").toLowerCase().includes(query))
    : state.documents;

  if (!filtered.length) {
    container.innerHTML = "<div class='muted'>No documents yet.</div>";
    return;
  }

  filtered
    .slice()
    .reverse()
    .forEach((doc) => {
      const item = document.createElement("div");
      item.className = "file";
      item.innerHTML = `<div><strong>${doc.filename}</strong></div>
      <div class='row'><span class='badge'>${doc.status}</span><button class='button ghost' data-doc-id='${doc.id}'>Delete</button></div>`;
      container.appendChild(item);
    });
}

function createMessageNode(role, markdownText) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  const content = document.createElement("div");
  const parser = window.marked && typeof window.marked.parse === "function" ? window.marked.parse : null;
  if (parser) {
    content.innerHTML = parser(markdownText || "");
  } else {
    content.textContent = markdownText || "";
  }
  wrapper.appendChild(content);
  byId("chat-messages").appendChild(wrapper);
  byId("chat-messages").scrollTop = byId("chat-messages").scrollHeight;
  return content;
}

function updateRightPanel(latencyMs, sources) {
  byId("debug-info-card").textContent = `Debug: latency ${Math.round(latencyMs)} ms`;
  byId("token-usage-card").textContent = "Token usage: streaming enabled";
  if (sources && sources.length) {
    byId("retrieved-chunks-card").textContent = `Retrieved: ${sources.slice(0, 3).map((s) => s.source_file).join(", ")}`;
  } else {
    byId("retrieved-chunks-card").textContent = "Retrieved: no source list returned.";
  }
}

async function sendChat() {
  const input = byId("chat-input");
  const query = input.value.trim();
  if (!query) return;

  state.chats.push({ role: "user", content: query });
  createMessageNode("user", `**User:** ${query}`);
  input.value = "";

  const answerNode = createMessageNode("assistant", "...");
  const started = performance.now();

  const payload = {
    query,
    project_id: state.currentProject,
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

  try {
    const start = await fetchJson(`${apiBase}/query/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let full = "";
    let done = false;
    let sources = [];

    while (!done) {
      const next = await fetchJson(`${apiBase}/query/next/${start.job_id}?max_chunks=5`);
      full += next.delta || "";
      const parser = window.marked && typeof window.marked.parse === "function" ? window.marked.parse : null;
      if (parser) {
        answerNode.innerHTML = parser(full || "...");
      } else {
        answerNode.textContent = full || "...";
      }
      done = !!next.done;
      if (done) {
        sources = next.sources || [];
      } else {
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    }

    state.chats.push({ role: "assistant", content: full });
    updateRightPanel(performance.now() - started, sources);
    await refreshDashboard();
  } catch (error) {
    answerNode.textContent = `Query failed: ${error.message}`;
  }
}

async function showMetricsDialog() {
  const metrics = await fetchJson(`${apiBase}/workspace/metrics`);
  byId("metrics-content").textContent = JSON.stringify(metrics, null, 2);
  byId("metrics-dialog").showModal();
}

function initDropZone() {
  const zone = byId("project-drop-zone");
  const input = byId("project-files");

  zone.addEventListener("click", () => input.click());

  ["dragenter", "dragover"].forEach((evtName) => {
    zone.addEventListener(evtName, (evt) => {
      evt.preventDefault();
      zone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evtName) => {
    zone.addEventListener(evtName, (evt) => {
      evt.preventDefault();
      zone.classList.remove("dragover");
    });
  });

  zone.addEventListener("drop", (evt) => {
    setPendingFiles(evt.dataTransfer.files);
  });

  input.addEventListener("change", () => setPendingFiles(input.files));
}

function applySidebarState() {
  const shellSidebar = byId("shell-sidebar");
  if (!shellSidebar) {
    return;
  }
  shellSidebar.classList.toggle("expanded", state.ui.sidebarOpen);
}

function applyWorkspacePanelState() {
  const workspaceApp = byId("workspace-app");
  const rightPanel = byId("right-panel");
  const toggleRight = byId("toggle-right");
  if (!workspaceApp || !rightPanel || !toggleRight) {
    return;
  }

  rightPanel.classList.toggle("open", state.ui.rightPanelOpen);
  toggleRight.textContent = state.ui.rightPanelOpen ? "Close" : "Open";
  workspaceApp.classList.toggle("right-open", state.ui.rightPanelOpen);
}

function wireEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const page = btn.dataset.view;
      setActivePage(page, state.currentProject);
      if (page === "workspace") {
        await loadProjectDocuments();
      }
    });
  });

  byId("sidebar-toggle").addEventListener("click", () => {
    state.ui.sidebarOpen = !state.ui.sidebarOpen;
    applySidebarState();
  });

  byId("sidebar-new-project").addEventListener("click", () => setActivePage("create-project"));
  byId("dashboard-create-project").addEventListener("click", () => setActivePage("create-project"));
  byId("home-link").addEventListener("click", (evt) => {
    evt.preventDefault();
    setActivePage("dashboard", state.currentProject);
  });
  byId("profile-btn").addEventListener("click", () => {
    setActivePage("workspace", state.currentProject);
  });
  byId("settings-btn").addEventListener("click", showMetricsDialog);

  byId("project-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const name = byId("project-name").value.trim();
    if (!name) return;

    const project = await createProject(name);
    if (state.pendingProjectFiles.length) {
      const upload = await uploadFiles(project.id, state.pendingProjectFiles);
      byId("upload-result").textContent = `Created ${project.name}. Uploaded ${upload.succeeded}/${upload.total_files}.`;
    } else {
      byId("upload-result").textContent = `Created ${project.name}.`;
    }

    state.pendingProjectFiles = [];
    byId("project-name").value = "";
    renderPendingProjectFiles();
    state.currentProject = project.id;
    await refreshDashboard();
    setActivePage("workspace", project.id);
    await loadProjectDocuments();
  });

  byId("project-files-preview").addEventListener("click", (evt) => {
    const idx = evt.target.getAttribute("data-remove");
    if (idx == null) return;
    state.pendingProjectFiles.splice(Number(idx), 1);
    renderPendingProjectFiles();
  });

  byId("chat-upload-btn").addEventListener("click", async () => {
    const files = byId("chat-upload-files").files;
    if (!files || !files.length) return;
    await uploadFiles(state.currentProject, files);
    await refreshDashboard();
    await loadProjectDocuments();
  });

  byId("chat-documents").addEventListener("click", async (evt) => {
    const docId = evt.target.getAttribute("data-doc-id");
    if (!docId) return;
    await deleteDocument(state.currentProject, docId);
    await loadProjectDocuments();
  });

  byId("doc-search").addEventListener("input", loadProjectDocuments);

  byId("chat-send-btn").addEventListener("click", sendChat);
  byId("chat-input").addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") {
      sendChat();
    }
  });

  byId("chat-new-project-btn").addEventListener("click", () => setActivePage("create-project"));
  byId("chat-statistics-btn").addEventListener("click", () => setActivePage("dashboard"));
  byId("chat-metrics-btn").addEventListener("click", showMetricsDialog);
  byId("chat-settings-btn").addEventListener("click", () => {
    state.ui.rightPanelOpen = !state.ui.rightPanelOpen;
    applyWorkspacePanelState();
  });

  byId("toggle-right").addEventListener("click", () => {
    state.ui.rightPanelOpen = !state.ui.rightPanelOpen;
    applyWorkspacePanelState();
  });

  byId("close-metrics").addEventListener("click", () => byId("metrics-dialog").close());

  window.addEventListener("hashchange", async () => {
    const parsed = parseHash();
    setActivePage(parsed.page, parsed.projectId, false);
    if (parsed.page === "workspace") {
      await loadProjectDocuments();
    }
  });

  initDropZone();
}

async function init() {
  wireEvents();
  applySidebarState();
  applyWorkspacePanelState();
  renderPendingProjectFiles();
  await refreshDashboard();

  const parsed = parseHash();
  setActivePage(parsed.page, parsed.projectId, false);
  if (parsed.page === "workspace") {
    await loadProjectDocuments();
  }
}

init();
