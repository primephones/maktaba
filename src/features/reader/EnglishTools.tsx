import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, sectionId } from '../../db/db';
import type { Book, Translation } from '../../db/types';
import { addMemory, getMemory, setMemory } from '../../ai/context';
import { translateNow } from '../../ai/translation';
import { fold } from '../../../server/src/glossary';
import type { MemoryItem } from '../../../server/src/translate';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

/** Remembers how a name or term is to be put into English in this book, replacing what was there. */
export async function rememberTerm(bookKey: string, source: string, en: string): Promise<void> {
  await addMemory(bookKey, [{ source, en }]);
  await setMemory(bookKey, source, en);
}

/**
 * One paragraph's English, to put right: correct it by hand, have it translated again
 * (closer to the wording, or more natural), and fix how a name or term is said throughout
 * the book.
 */
export function ParagraphEnglish({ book, section, block, onClose }: { book: Book; section: number; block: number; onClose: () => void }) {
  const tr = useLiveQuery(() => db.translations.get(`${book.id}:${section}:${block}`), [book.id, section, block]);
  const source = useLiveQuery(async () => (await db.sections.get(sectionId(book.id, section)))?.blocks[block], [book.id, section, block]);
  const memory = useLiveQuery(() => getMemory(book.hash), [book.hash]) ?? [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [term, setTerm] = useState({ source: '', en: '' });
  useEffect(() => {
    if (tr) setText(tr.en);
  }, [tr?.updatedAt]);

  const here = source ? memory.filter((m) => fold(source.text).includes(fold(m.source))) : [];

  const save = async () => {
    if (!tr || !text.trim()) return;
    await db.translations.update(tr.id, { en: text.trim(), uncertain: text.includes('†') ? tr.uncertain : [], label: 'checked', provider: 'you', model: 'Corrected by you', updatedAt: Date.now() });
    toast('Your correction is kept.');
    onClose();
  };
  const again = async (tone?: 'literal' | 'natural') => {
    if (!source) return;
    setBusy(tone === 'literal' ? 'Translating it more closely…' : tone === 'natural' ? 'Translating it more naturally…' : 'Translating it again…');
    try {
      const sec = await db.sections.get(sectionId(book.id, section));
      await translateNow(book, [{ id: `${section}:${block}`, section, block, text: source.text, kind: source.t === 'h' ? 'h' : source.t === 'quote' ? 'quote' : 'p', chapter: sec?.title ?? '' }], { fresh: true, tone });
      toast('Translated again.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const keepTerm = async () => {
    if (!term.source.trim() || !term.en.trim()) return;
    await rememberTerm(book.hash, term.source.trim(), term.en.trim());
    setTerm({ source: '', en: '' });
    toast('Kept for this book. Translate the paragraph again to use it here.');
  };

  return (
    <Sheet title="This paragraph’s English" onClose={onClose}>
      {source && (
        <p className="pe-orig" dir="auto" lang={book.lang === 'other' ? undefined : book.lang}>
          {source.text}
        </p>
      )}
      <label className="stack">
        English
        <span className="field">
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} dir="ltr" lang="en" aria-label="English of this paragraph" />
        </span>
      </label>
      <button className="btn btn--primary btn--block" disabled={!tr || text.trim() === tr.en.trim()} onClick={() => void save()}>
        Keep my correction
      </button>
      <div className="ctl">
        <div className="lbl"><span><span className="ai-mark" aria-hidden="true">✦</span> Translate it again</span><span>{busy ?? ''}</span></div>
        <div className="seg" role="group" aria-label="Translate it again">
          <button disabled={!!busy} onClick={() => void again('literal')}>More literal</button>
          <button disabled={!!busy} onClick={() => void again()}>Again</button>
          <button disabled={!!busy} onClick={() => void again('natural')}>More natural</button>
        </div>
      </div>
      <div className="section-title">Names and terms</div>
      {here.length > 0 && (
        <div className="list">
          {here.map((m) => (
            <TermRow key={m.source} bookKey={book.hash} item={m} />
          ))}
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>Always put a word or name of this book into English your way:</p>
      <div className="pe-term">
        <span className="field"><input value={term.source} onChange={(e) => setTerm({ ...term, source: e.target.value })} placeholder="As in the book" dir="auto" aria-label="The word or name as in the book" /></span>
        <span className="field"><input value={term.en} onChange={(e) => setTerm({ ...term, en: e.target.value })} placeholder="In English" dir="ltr" aria-label="Always in English as" /></span>
        <button className="btn" disabled={!term.source.trim() || !term.en.trim()} onClick={() => void keepTerm()}>Keep</button>
      </div>
    </Sheet>
  );
}

/** One remembered name or term: how it is said in English, which can be changed or forgotten. */
function TermRow({ bookKey, item }: { bookKey: string; item: MemoryItem }) {
  const [en, setEn] = useState(item.en);
  const [editing, setEditing] = useState(false);
  return (
    <div className="row term-row">
      <span className="grow">
        <span className="title" dir="auto">{item.source}</span>
        {editing ? (
          <span className="field"><input value={en} onChange={(e) => setEn(e.target.value)} dir="ltr" aria-label={`English for ${item.source}`} autoFocus /></span>
        ) : (
          <div className="sub">{item.en}</div>
        )}
      </span>
      {editing ? (
        <button className="btn" onClick={() => void setMemory(bookKey, item.source, en.trim()).then(() => setEditing(false))} disabled={!en.trim()}>Save</button>
      ) : (
        <>
          <button className="icon-btn" aria-label={`Change the English for ${item.source}`} onClick={() => setEditing(true)}><Icon name="edit" size={20} /></button>
          <button className="icon-btn" aria-label={`Forget ${item.source}`} onClick={() => void setMemory(bookKey, item.source, '')}><Icon name="trash" size={20} /></button>
        </>
      )}
    </div>
  );
}

/** The book's word list: every name and term its English has used, to read through and correct. */
export function WordList({ book, onClose }: { book: Book; onClose: () => void }) {
  const memory = useLiveQuery(() => getMemory(book.hash), [book.hash]);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState({ source: '', en: '' });
  const shown = (memory ?? []).filter((m) => !q.trim() || fold(m.source).includes(fold(q)) || m.en.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.en.localeCompare(b.en));
  return (
    <Sheet title="Names and terms in this book" onClose={onClose}>
      <p className="muted small" style={{ margin: 0 }}>
        Your AI keeps the names and special terms of this book here, so they are said the same way on every page. Change any of them, and the English made from now on follows.
      </p>
      <span className="field"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name or term" aria-label="Find a name or term" dir="auto" /></span>
      {memory === undefined ? null : shown.length ? (
        <div className="list">
          {shown.map((m) => (
            <TermRow key={m.source} bookKey={book.hash} item={m} />
          ))}
        </div>
      ) : (
        <p className="muted">{memory.length ? 'Nothing matches.' : 'None yet. They are gathered as the book is translated.'}</p>
      )}
      <div className="section-title">Add one</div>
      <div className="pe-term">
        <span className="field"><input value={term.source} onChange={(e) => setTerm({ ...term, source: e.target.value })} placeholder="As in the book" dir="auto" aria-label="The word or name as in the book" /></span>
        <span className="field"><input value={term.en} onChange={(e) => setTerm({ ...term, en: e.target.value })} placeholder="In English" dir="ltr" aria-label="Always in English as" /></span>
        <button
          className="btn"
          disabled={!term.source.trim() || !term.en.trim()}
          onClick={() => void rememberTerm(book.hash, term.source.trim(), term.en.trim()).then(() => setTerm({ source: '', en: '' }))}
        >
          Add
        </button>
      </div>
    </Sheet>
  );
}

export type { Translation };
