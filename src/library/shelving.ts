import { db, uid } from '../db/db';
import type { Book, Folder } from '../db/types';
import { normalizeForSearch } from '../lib/arabic';

/**
 * Where a new book belongs: with the other volumes of its work if they are already in a
 * folder; otherwise by its subject, read from its title (Arabic, Urdu, Persian, Pashto,
 * Malay or English), into a folder of that subject, made if there is none.
 */

export interface Subject {
  id: string;
  /** The folder name used when one has to be made. */
  name: string;
  /** Words in a title that mark the subject (any of the reader's languages). */
  words: string[];
}

export const SUBJECTS: Subject[] = [
  { id: 'usul', name: 'Uṣūl al-fiqh', words: ['اصول الفقه', 'أصول الفقه', 'الاصول', 'الأصول', 'المستصفى', 'الرسالة', 'المحصول', 'الموافقات', 'البرهان', 'روضة الناظر', 'جمع الجوامع', 'مسلم الثبوت', 'نور الانوار', 'نور الأنوار', 'اصول الشاشي', 'أصول الشاشي', 'التوضيح', 'usul', 'uṣūl', 'legal theory', 'jurisprudence principles'] },
  { id: 'hadith-sharh', name: 'Ḥadīth commentaries', words: ['فتح الباري', 'عمدة القاري', 'ارشاد الساري', 'إرشاد الساري', 'شرح صحيح', 'شرح النووي', 'المنهاج شرح', 'عون المعبود', 'بذل المجهود', 'تحفة الاحوذي', 'تحفة الأحوذي', 'الكوكب الدري', 'فيض الباري', 'لامع الدراري', 'معالم السنن', 'حاشية السندي', 'فتح الملهم', 'اعلاء السنن', 'إعلاء السنن', 'معارف السنن', 'اوجز المسالك', 'أوجز المسالك', 'شرح معاني الآثار', 'التعليق الممجد'] },
  { id: 'hadith', name: 'Ḥadīth', words: ['حديث', 'الحديث', 'صحيح البخاري', 'صحيح مسلم', 'الجامع الصحيح', 'سنن', 'مسند', 'الموطا', 'الموطأ', 'مشكاة', 'رياض الصالحين', 'الاربعين', 'الأربعين', 'بلوغ المرام', 'hadith', 'ḥadīth', 'sunan', 'sahih', 'ṣaḥīḥ', 'musnad', 'muwatta'] },
  { id: 'fiqh', name: 'Fiqh', words: ['فقه', 'الفقه', 'الهداية', 'القدوري', 'مختصر', 'المبسوط', 'بدائع الصنائع', 'رد المحتار', 'الدر المختار', 'كنز الدقائق', 'تبيين الحقائق', 'فتح القدير', 'البحر الرائق', 'الاختيار', 'نور الايضاح', 'نور الإيضاح', 'مراقي الفلاح', 'العناية', 'البناية', 'شرح الوقاية', 'السعاية', 'فتاوى', 'فتاوي', 'فتاویٰ', 'فتاوی', 'بہشتی زیور', 'احکام', 'مسائل', 'طهارة', 'طہارت', 'نماز', 'صلاة', 'زكاة', 'زکوٰۃ', 'fiqh', 'fatawa', 'fatwa', 'hanafi', 'ḥanafī', 'hukum', 'feqah'] },
  { id: 'tafsir', name: 'Tafsīr and Qurʾān', words: ['تفسير', 'تفسیر', 'القرآن', 'قرآن', 'التاويل', 'التأويل', 'علوم القرآن', 'tafsir', 'tafsīr', "qur'an", 'quran', 'qurʾān'] },
  { id: 'aqida', name: 'ʿAqīda', words: ['عقيدة', 'عقیدہ', 'العقائد', 'عقائد', 'التوحيد', 'توحيد', 'الايمان', 'الإيمان', 'الطحاوية', 'aqida', 'ʿaqīda', 'creed', 'akidah', 'tauhid'] },
  { id: 'sira', name: 'Sīra and history', words: ['سيرة', 'سیرت', 'السيرة', 'تاريخ', 'تاریخ', 'طبقات', 'تراجم', 'sira', 'sīra', 'seerah', 'history', 'sejarah'] },
  { id: 'arabic', name: 'Arabic language', words: ['نحو', 'النحو', 'صرف', 'الصرف', 'اعراب', 'إعراب', 'بلاغة', 'البلاغة', 'الاجرومية', 'الآجرومية', 'الفية', 'ألفية', 'قطر الندى', 'شذور الذهب', 'مغني اللبيب', 'لغة', 'grammar', 'nahw', 'sarf', 'balagha'] },
  { id: 'tasawwuf', name: 'Tazkiya and taṣawwuf', words: ['تصوف', 'التصوف', 'تزكية', 'احياء علوم الدين', 'إحياء علوم الدين', 'الحكم العطائية', 'سلوک', 'tasawwuf', 'taṣawwuf', 'tazkiya'] },
  { id: 'law', name: 'Constitutions and law', words: ['دستور', 'الدستور', 'آئین', 'قانون', 'constitution', 'perlembagaan', 'law of', 'basic law', 'qanun'] },
];

const fold = (s: string) => ` ${normalizeForSearch(s).replace(/[\s\p{P}]+/gu, ' ').trim()} `;

/** The subject of a book, from its title and author. */
export function subjectOf(book: Pick<Book, 'title' | 'author'>): Subject | undefined {
  const hay = fold(`${book.title} ${book.author ?? ''}`);
  // Commentaries are recognised before the works they comment on.
  return SUBJECTS.find((s) => s.words.some((w) => hay.includes(fold(w))));
}

export interface Suggestion {
  folderId?: string;
  /** A folder to make, when none fits yet. */
  newName?: string;
  /** Why, in a few words. */
  reason: string;
}

/** Where a book belongs, or nothing if Maktaba cannot tell. */
export async function suggestFolder(book: Book): Promise<Suggestion | null> {
  const folders = await db.folders.toArray();
  // With the other volumes of the same work.
  if (book.series) {
    const sibling = await db.books.where('series').equals(book.series).filter((b) => b.id !== book.id && !!b.folderId).first();
    if (sibling?.folderId && folders.some((f) => f.id === sibling.folderId)) return { folderId: sibling.folderId, reason: 'with its other volumes' };
  }
  const subject = subjectOf(book);
  if (!subject) return null;
  const existing = folders.find((f) => folderMatches(f, subject));
  if (existing) return { folderId: existing.id, reason: subject.name };
  return { newName: subject.name, reason: subject.name };
}

function folderMatches(f: Folder, s: Subject): boolean {
  const name = fold(f.name);
  if (name.trim() === fold(s.name).trim()) return true;
  // A folder the reader named themselves, in any language, that names the subject.
  return s.words.some((w) => {
    const fw = fold(w).trim();
    return fw.length > 2 && name.includes(` ${fw} `);
  });
}

/** Puts books into folders, making the folders that do not exist yet. */
export async function shelve(choices: Array<{ bookId: string; folderId?: string; newName?: string }>): Promise<void> {
  const made = new Map<string, string>();
  for (const c of choices) {
    let folderId = c.folderId;
    if (!folderId && c.newName) {
      folderId = made.get(c.newName);
      if (!folderId) {
        const existing = await db.folders.filter((f) => f.name === c.newName && !f.parentId).first();
        folderId = existing?.id ?? uid();
        if (!existing) await db.folders.add({ id: folderId, name: c.newName, createdAt: Date.now() });
        made.set(c.newName, folderId);
      }
    }
    await db.books.update(c.bookId, { folderId });
  }
}
