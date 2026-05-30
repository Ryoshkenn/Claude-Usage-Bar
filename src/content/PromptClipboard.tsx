import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PromptEntry } from "../shared/types";
import { getPrompts, savePrompts } from "../shared/storage";

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const insertIntoComposer = (text: string) => {
  const editable = document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]');
  if (editable) {
    editable.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editable.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editable.textContent = text;
    }
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
  if (textarea) {
    textarea.focus();
    textarea.value = text;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  return false;
};

type ClipboardView = "list" | "new" | "edit";

export const PromptClipboard = () => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ClipboardView>("list");
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const loadedRef = useRef(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formPinned, setFormPinned] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [closing, setClosing] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    getPrompts().then((data) => {
      setPrompts(data);
      loadedRef.current = true;
    });
  }, []);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setRenderOpen(false);
    }, 180);
  };

  const handleBackdropMouseDown = () => {
    handleClose();
  };

  useEffect(() => {
    if (!open) {
      setView("list");
      setSearch("");
      setActiveTab("All");
      setEditId(null);
      setPanelStyle({});
      setRenderOpen(false);
      setClosing(false);
      return;
    }
    setRenderOpen(true);
    const composer = document.querySelector<HTMLElement>(
      "div.cursor-text.rounded-\\[20px\\], .cub-composer-host"
    );
    if (composer) {
      const rect = composer.getBoundingClientRect();
      const composerCenterX = rect.left + rect.width / 2;
      const viewportCenterX = window.innerWidth / 2;
      const offset = composerCenterX - viewportCenterX;
      setPanelStyle({ "--cub-panel-offset": `translateX(${offset}px)` } as CSSProperties);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of prompts) {
      for (const t of p.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [prompts]);

  const tabs = useMemo(() => {
    const t = ["All"];
    if (prompts.some((p) => p.pinned)) t.push("Pinned");
    t.push(...allTags);
    return t;
  }, [allTags, prompts]);

  const filteredPrompts = useMemo(() => {
    let list = prompts;
    if (activeTab === "Pinned") {
      list = list.filter((p) => p.pinned);
    } else if (activeTab !== "All") {
      list = list.filter((p) => p.tags.includes(activeTab));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
    }
    return list;
  }, [prompts, activeTab, search]);

  const save = async (updated: PromptEntry[]) => {
    setPrompts(updated);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await savePrompts(updated);
    }
  };

  const handleCopy = async (e: React.MouseEvent, id: string, content: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // silent
    }
  };

  const handleInsert = (text: string) => {
    insertIntoComposer(text);
    setOpen(false);
  };

  const startEdit = (e: React.MouseEvent, entry: PromptEntry) => {
    e.stopPropagation();
    setEditId(entry.id);
    setFormTitle(entry.title);
    setFormContent(entry.content);
    setFormTags(entry.tags.join(", "));
    setFormPinned(entry.pinned);
    setView("edit");
  };

  const openNew = () => {
    setEditId(null);
    setFormTitle("");
    setFormContent("");
    setFormTags("");
    setFormPinned(false);
    setView("new");
  };

  const goBack = () => {
    setView("list");
    setEditId(null);
  };

  const handleSave = () => {
    if (!formContent.trim()) return;
    const tags = formTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (editId) {
      const updated = prompts.map((p) =>
        p.id === editId
          ? { ...p, title: formTitle, content: formContent, tags, pinned: formPinned, updatedAt: Date.now() }
          : p,
      );
      void save(updated);
    } else {
      const entry: PromptEntry = {
        id: crypto.randomUUID(),
        title: formTitle,
        content: formContent,
        tags,
        pinned: formPinned,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      void save([...prompts, entry]);
    }
    setView("list");
    setEditId(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = prompts.filter((p) => p.id !== id);
    void save(updated);
    if (view === "edit" && editId === id) goBack();
  };

  const toggleTagChip = (tag: string) => {
    const current = formTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (current.includes(tag)) {
      setFormTags(current.filter((t) => t !== tag).join(", "));
    } else {
      setFormTags([...current, tag].join(", "));
    }
  };

  const formTagList = formTags.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <>
      <button
        ref={btnRef}
        className={`cub-prompt-button${open ? " active" : ""}`}
        type="button"
        aria-label="Prompt clipboard"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⌘
      </button>
      {(renderOpen || closing) && (
        <div
          className={`cub-prompt-backdrop${closing ? " cub-prompt-closing" : ""}`}
          onMouseDown={handleBackdropMouseDown}
        >
          <section
            ref={panelRef}
            className={`cub-prompt-panel cub-prompt-view-${view}${view === "new" || view === "edit" ? " wide" : ""}${closing ? " cub-prompt-closing" : ""}`}
            role="dialog"
            aria-label="Prompt clipboard"
            style={panelStyle}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {view === "list" ? (
              <>
                <div className="cub-prompt-head">
                  <span className="cub-prompt-title">Prompt Clipboard</span>
                  <button className="cub-prompt-new" type="button" onClick={openNew}>+ New</button>
                </div>

                <input
                  className="cub-prompt-search"
                  type="text"
                  placeholder="Search prompts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                <div className="cub-prompt-tabs">
                  {tabs.map((tab) => (
                    <span
                      key={tab}
                      className={`cub-prompt-tab${activeTab === tab ? " active" : ""}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab}
                    </span>
                  ))}
                </div>

                <div className="cub-prompt-list">
                  {filteredPrompts.length === 0 && (
                    <div className="cub-prompt-empty">No prompts found</div>
                  )}
                  {filteredPrompts.map((entry) => (
                    <article
                      key={entry.id}
                      className="cub-prompt-item"
                      onClick={() => handleInsert(entry.content)}
                    >
                      <div className="cub-prompt-item-top">
                        <span className="cub-prompt-name">{entry.title || "Untitled"}</span>
                      </div>
                      <div className="cub-prompt-desc">{entry.content}</div>
                      <div className="cub-prompt-actions">
                        <button
                          type="button"
                          className="cub-prompt-action"
                          onClick={(e) => handleCopy(e, entry.id, entry.content)}
                        >
                          {copiedId === entry.id ? <CheckIcon /> : "Copy"}
                        </button>
                        <button
                          type="button"
                          className="cub-prompt-action"
                          onClick={(e) => startEdit(e, entry)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="cub-prompt-action primary"
                          onClick={() => handleInsert(entry.content)}
                        >
                          Insert
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="cub-prompt-head">
                  <button className="cub-prompt-back" type="button" onClick={goBack}>← Back</button>
                  <span className="cub-prompt-title">{editId ? "Edit prompt" : "New prompt"}</span>
                </div>

                <div className="cub-form-row">
                  <label className="cub-label">
                    Title
                    <input
                      className="cub-field"
                      type="text"
                      placeholder="Prompt title"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                    />
                  </label>

                  <label className="cub-label">
                    Prompt text
                    <textarea
                      className="cub-textarea"
                      placeholder="Write your prompt..."
                      value={formContent}
                      onChange={(e) => setFormContent(e.target.value)}
                    />
                  </label>

                  <label className="cub-label">
                    Tags
                    <input
                      className="cub-field"
                      type="text"
                      placeholder="coding, debug, writing"
                      value={formTags}
                      onChange={(e) => setFormTags(e.target.value)}
                    />
                  </label>
                </div>

                {allTags.length > 0 && (
                  <div className="cub-chip-row">
                    {allTags.map((tag) => (
                      <span
                        key={tag}
                        className={`cub-chip${formTagList.includes(tag) ? " active" : ""}`}
                        onClick={() => toggleTagChip(tag)}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="cub-checkbox-row" onClick={() => setFormPinned(!formPinned)}>
                  <span>Pin this prompt to the top</span>
                  <span className={`cub-toggle${formPinned ? " active" : ""}`} aria-hidden="true" />
                </div>

                {formContent.trim() && (
                  <div className="cub-preview-box">
                    <span className="cub-preview-title">Preview</span>
                    <span className="cub-preview-text">{formContent}</span>
                  </div>
                )}

                <div className="cub-form-actions">
                  <button type="button" className="cub-secondary" onClick={goBack}>Cancel</button>
                  <button
                    type="button"
                    className="cub-primary"
                    onClick={handleSave}
                    disabled={!formContent.trim()}
                  >
                    {editId ? "Save" : "Save prompt"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
};
