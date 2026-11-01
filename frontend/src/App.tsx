import { useState } from 'react'

type SelectedFile = { id: string; file: File }

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export default function App() {
  const [files, setFiles] = useState<SelectedFile[]>([])

  return (
    <div className="app-shell">
      <header className="masthead">
        <a className="brand" href="/">InvenTree <span>Importer</span></a>
        <span className="scaffold-badge">Intake scaffold</span>
      </header>
      <main>
        <p className="eyebrow">Start with your source</p>
        <h1>A place for the paperwork.</h1>
        <p className="intro">Gather component lists, receipts and photos for review.</p>
        <section className="intake-card" aria-labelledby="intake-title">
          <div className="card-heading">
            <div><h2 id="intake-title">Source files</h2><p>Preview file names and sizes in this tab.</p></div>
            <label className="choose-button">
              Choose files
              <input aria-label="Choose source files" type="file" multiple
                accept=".json,.yaml,.yml,.csv,.pdf,.png,.jpg,.jpeg"
                onChange={(event) => {
                  const selected = Array.from(event.currentTarget.files ?? [])
                    .map((file) => ({ id: crypto.randomUUID(), file }))
                  setFiles((current) => [...current, ...selected])
                  event.currentTarget.value = ''
                }} />
            </label>
          </div>
          {files.length === 0 ? (
            <div className="empty-state"><span aria-hidden="true" className="paper-icon">↥</span>
              <h3>Your source files go here</h3>
              <p>Choose a parts list, receipt or component photo to begin.</p>
            </div>
          ) : (
            <ul className="file-list" aria-label="Selected source files">
              {files.map(({ id, file }) => (
                <li key={id}><div><strong>{file.name}</strong><span>{fileSize(file.size)}</span></div>
                  <button type="button" className="remove-button" aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles((current) => current.filter((item) => item.id !== id))}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="selection-footer">
            <p role="status">{files.length} {files.length === 1 ? 'file' : 'files'} selected</p>
            {files.length > 0 && <button type="button" className="text-button" onClick={() => setFiles([])}>Clear selection</button>}
          </div>
        </section>
        <aside className="scope-note"><strong>Local preview · scaffold</strong>
          <p>Files stay in this tab. Upload, parsing and inventory actions are not connected.</p>
        </aside>
      </main>
      <footer>InvenTree Importer <span>Source → review → inventory</span></footer>
    </div>
  )
}
