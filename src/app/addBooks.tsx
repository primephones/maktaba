import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ACCEPT, addFiles, type AddResult } from '../import';
import { requestPersistence } from '../db/db';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toast';
import { Icon } from '../ui/Icon';

/**
 * The single way books get into the app. Every Add button opens the same file picker
 * and goes through the same queue; duplicates and unreadable files are reported plainly.
 */
export function useAddBooks(): { pick: (folderId?: string) => void; addDropped: (files: File[]) => void; element: ReactNode } {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<string | undefined>(undefined);
  const [review, setReview] = useState<{ results: AddResult[]; files: File[] } | null>(null);

  const add = useCallback(async (files: File[], allowDuplicates = false) => {
    if (!files.length) return;
    void requestPersistence();
    const results = await addFiles(files, { allowDuplicates, folderId: folderRef.current });
    const added = results.filter((r) => r.bookId).length;
    const problems = results.filter((r) => r.duplicateOf || r.error);
    if (added) toast(added === 1 ? 'Book added. Preparing it now…' : `${added} books added. Preparing them now…`);
    if (problems.length) setReview({ results: problems, files });
  }, []);

  const pick = useCallback((folderId?: string) => {
    folderRef.current = folderId;
    inputRef.current?.click();
  }, []);

  const element = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        data-testid="add-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void add(files);
        }}
      />
      {review && (
        <Sheet title="Some files need a look" onClose={() => setReview(null)}>
          <div className="list">
            {review.results.map((r) => (
              <div className="row" key={r.fileName}>
                <Icon name={r.error ? 'warn' : 'info'} />
                <div className="grow">
                  <div className="title">{r.fileName}</div>
                  <div className="sub">{r.error ?? `Already in your library as “${r.duplicateOf!.title}”.`}</div>
                </div>
              </div>
            ))}
          </div>
          {review.results.some((r) => r.duplicateOf) && (
            <button
              className="btn btn--block"
              onClick={() => {
                const names = new Set(review.results.filter((r) => r.duplicateOf).map((r) => r.fileName));
                const again = review.files.filter((f) => names.has(f.name));
                setReview(null);
                void add(again, true);
              }}
            >
              Add the duplicates anyway
            </button>
          )}
          <button className="btn btn--primary btn--block" onClick={() => setReview(null)}>Done</button>
        </Sheet>
      )}
    </>
  );

  return { pick, addDropped: (files) => void add(files), element };
}
