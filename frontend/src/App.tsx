import { useCallback, useEffect, useState } from "react";
import {
  createString,
  deleteString,
  discoverProjectId,
  fetchProject,
  fetchStrings,
  Project,
  StringEntry,
  translateString,
  updateString,
  updateTranslation,
} from "./api";

type ModalMode = "create" | "edit" | null;

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [strings, setStrings] = useState<StringEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editing, setEditing] = useState<StringEntry | null>(null);
  const [formKey, setFormKey] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    setError(null);
    try {
      const [projectData, stringData] = await Promise.all([fetchProject(pid), fetchStrings(pid)]);
      setProject(projectData);
      setStrings(stringData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const pid = await discoverProjectId();
        setProjectId(pid);
        await load(pid);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to bootstrap project");
        setLoading(false);
      }
    })();
  }, [load]);

  const openCreate = () => {
    setModalMode("create");
    setEditing(null);
    setFormKey("");
    setFormSource("");
    setFormDescription("");
  };

  const openEdit = (entry: StringEntry) => {
    setModalMode("edit");
    setEditing(entry);
    setFormKey(entry.key);
    setFormSource(entry.source_text);
    setFormDescription(entry.description || "");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditing(null);
  };

  const handleSave = async () => {
    if (!projectId) return;
    try {
      if (modalMode === "create") {
        await createString(projectId, {
          key: formKey.trim(),
          source_text: formSource.trim(),
          description: formDescription.trim() || undefined,
        });
      } else if (editing) {
        await updateString(projectId, editing.key, {
          source_text: formSource.trim(),
          description: formDescription.trim() || undefined,
        });
      }
      closeModal();
      await load(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleDelete = async (key: string) => {
    if (!projectId || !confirm(`Delete "${key}"?`)) return;
    try {
      await deleteString(projectId, key);
      await load(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleTranslationBlur = async (entry: StringEntry, locale: string, value: string) => {
    if (!projectId) return;
    const existing = entry.translations.find((t) => t.locale === locale);
    if (existing?.value === value) return;
    try {
      await updateTranslation(projectId, entry.key, locale, {
        value,
        status: value.trim() ? "live" : "draft",
      });
      await load(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleTranslateRow = async (key: string) => {
    if (!projectId) return;
    setTranslatingKey(key);
    setError(null);
    try {
      await translateString(projectId, key);
      await load(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setTranslatingKey(null);
    }
  };

  const locales = project ? [project.base_language, ...project.target_languages] : [];

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>{project?.name || "TMS"}</h1>
          <p>Translation Management System — MVP Demo</p>
          {project && (
            <div className="chips">
              {locales.map((locale) => (
                <span key={locale} className="chip">
                  {locale.toUpperCase()}
                </span>
              ))}
              <span className="chip">{project.string_count} strings</span>
            </div>
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={openCreate}>
            Add string
          </button>
          {projectId && (
            <button className="btn" onClick={() => load(projectId)}>
              Refresh
            </button>
          )}
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading">Loading strings...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  {locales.map((locale) => (
                    <th key={locale}>{locale.toUpperCase()}</th>
                  ))}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {strings.map((entry) => {
                  const worstStatus = entry.translations.some((t) => t.status === "draft" || !t.value)
                    ? "draft"
                    : "live";
                  return (
                    <tr key={entry.id}>
                      <td className="key-cell">{entry.key}</td>
                      <td>{entry.source_text}</td>
                      {project?.target_languages.map((locale) => {
                        const translation = entry.translations.find((t) => t.locale === locale);
                        return (
                          <td key={locale}>
                            <input
                              defaultValue={translation?.value || ""}
                              placeholder="—"
                              onBlur={(e) => handleTranslationBlur(entry, locale, e.target.value)}
                            />
                          </td>
                        );
                      })}
                      <td>
                        <span className={`status status-${worstStatus}`}>{worstStatus}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn btn-primary"
                            onClick={() => handleTranslateRow(entry.key)}
                            disabled={translatingKey === entry.key}
                          >
                            {translatingKey === entry.key ? "Translating..." : "Translate"}
                          </button>
                          <button className="btn" onClick={() => openEdit(entry)}>
                            Edit
                          </button>
                          <button className="btn btn-danger" onClick={() => handleDelete(entry.key)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {strings.length === 0 && (
                  <tr>
                    <td colSpan={locales.length + 3} className="empty">
                      No strings yet. Add one or run `tms push`.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalMode && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{modalMode === "create" ? "Add string" : "Edit string"}</h2>
            <div className="form-group">
              <label>Key</label>
              <input value={formKey} onChange={(e) => setFormKey(e.target.value)} disabled={modalMode === "edit"} />
            </div>
            <div className="form-group">
              <label>Source text (EN)</label>
              <textarea rows={3} value={formSource} onChange={(e) => setFormSource(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Description (AI context)</label>
              <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={closeModal}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
