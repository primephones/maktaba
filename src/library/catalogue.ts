import { db } from '../db/db';
import type { Book } from '../db/types';

/**
 * Classical books ready to download, from the OpenITI corpus (Open Islamicate Texts
 * Initiative; texts under CC BY-NC-SA 4.0: free to read and share, with attribution, not
 * for sale). Each is fetched straight from OpenITI's own repository when tapped, and
 * comes into the library like any other book. A commentary is linked to its matn, so
 * "In the commentary" knows where to go.
 */

export type CatalogueGroup = 'six' | 'shuruh' | 'deobandi' | 'mutun' | 'fiqh-shuruh';

export const GROUPS: Array<{ id: CatalogueGroup; title: string; sub: string }> = [
  { id: 'six', title: 'The six books of ḥadīth', sub: 'al-Kutub al-Sitta' },
  { id: 'shuruh', title: 'Their commentaries: classical', sub: 'Shurūḥ al-ḥadīth' },
  { id: 'deobandi', title: 'Commentaries: Deobandi and Indian Ḥanafī', sub: 'Gangohī, Sahāranpūrī, Lakhnawī' },
  { id: 'mutun', title: 'Ḥanafī fiqh: the main texts', sub: 'Mutūn' },
  { id: 'fiqh-shuruh', title: 'Ḥanafī fiqh: commentaries and great works', sub: 'Shurūḥ and mabsūṭāt' },
];

export interface CatalogueEntry {
  id: string;
  group: CatalogueGroup;
  /** English title, with the author where it helps. */
  en: string;
  ar: string;
  authorAr: string;
  /** Year of the author's death (AH). */
  died: number;
  /** Length in characters (for the download size). */
  chars: number;
  /** The catalogue id of the matn this comments on. */
  commentsOn: string | null;
  url: string;
}

export const CATALOGUE: CatalogueEntry[] = [
  {"id": "0256Bukhari.Sahih.JK000110-ara1", "group": "six", "en": "Ṣaḥīḥ al-Bukhārī", "ar": "الجامع الصحيح المختصر", "authorAr": "البخاري", "died": 256, "chars": 2349294, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0256Bukhari/0256Bukhari.Sahih/0256Bukhari.Sahih.JK000110-ara1.completed"},
  {"id": "0261Muslim.Sahih.Shamela0001727-ara1", "group": "six", "en": "Ṣaḥīḥ Muslim", "ar": "صحيح", "authorAr": "مسلم", "died": 261, "chars": 1945463, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0261Muslim/0261Muslim.Sahih/0261Muslim.Sahih.Shamela0001727-ara1.mARkdown"},
  {"id": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "group": "six", "en": "Sunan Abī Dāwūd", "ar": "سنن أبي داود", "authorAr": "سليمان بن الأشعث أبو داود السجستاني الأزدي", "died": 275, "chars": 1341565, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0275AbuDawudSijistani/0275AbuDawudSijistani.Sunan/0275AbuDawudSijistani.Sunan.JK000142-ara1"},
  {"id": "0279Tirmidhi.Sunan.JK000140-ara1", "group": "six", "en": "Jāmiʿ al-Tirmidhī", "ar": "سنن", "authorAr": "محمد بن عيسى أبو عيسى الترمذي السلمي", "died": 279, "chars": 1464470, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0300AH/master/data/0279Tirmidhi/0279Tirmidhi.Sunan/0279Tirmidhi.Sunan.JK000140-ara1.completed"},
  {"id": "0303Nasai.SunanSughra.JK000130-ara1", "group": "six", "en": "Sunan al-Nasāʾī", "ar": "سنن", "authorAr": "النسائي", "died": 303, "chars": 1388342, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0325AH/master/data/0303Nasai/0303Nasai.SunanSughra/0303Nasai.SunanSughra.JK000130-ara1.mARkdown"},
  {"id": "0273IbnMaja.Sunan.JK000141-ara1", "group": "six", "en": "Sunan Ibn Mājah", "ar": "سنن ابن ماجه", "authorAr": "محمد بن يزيد أبو عبدالله القزويني", "died": 273, "chars": 979610, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0273IbnMaja/0273IbnMaja.Sunan/0273IbnMaja.Sunan.JK000141-ara1"},
  {"id": "0852IbnHajarCasqalani.FathBari.JK000166-ara1", "group": "shuruh", "en": "Fatḥ al-Bārī (Ibn Ḥajar)", "ar": "فتح الباري", "authorAr": "ابن حجر العسقلاني", "died": 852, "chars": 13295094, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0852IbnHajarCasqalani/0852IbnHajarCasqalani.FathBari/0852IbnHajarCasqalani.FathBari.JK000166-ara1"},
  {"id": "0855BadrDinCayni.CumdatQari.Shamela0005756-ara1", "group": "shuruh", "en": "ʿUmdat al-Qārī (al-ʿAynī, Ḥanafī)", "ar": "عمدة القاري شرح صحيح البخاري", "authorAr": "بدر الدين العيني", "died": 855, "chars": 19001707, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0855BadrDinCayni/0855BadrDinCayni.CumdatQari/0855BadrDinCayni.CumdatQari.Shamela0005756-ara1.completed"},
  {"id": "0923AhmadQastallani.IrshadSari.Shamela0021715-ara1", "group": "shuruh", "en": "Irshād al-Sārī (al-Qasṭallānī)", "ar": "ارشاد الساري لشرح صحيح البخاري", "authorAr": "القسطلاني", "died": 923, "chars": 14017528, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0925AH/master/data/0923AhmadQastallani/0923AhmadQastallani.IrshadSari/0923AhmadQastallani.IrshadSari.Shamela0021715-ara1.mARkdown"},
  {"id": "1138IbnCabdHadiNurDinSindi.HashiyaCalaSahihBukhari.ShamAY0035961-ara1", "group": "shuruh", "en": "Ḥāshiyat al-Sindī on al-Bukhārī", "ar": "حاشية السندى على صحيح البخارى", "authorAr": "محمد بن عبد الهادي التتوي، أبو الحسن، نور الدين السندي", "died": 1138, "chars": 637191, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1150AH/master/data/1138IbnCabdHadiNurDinSindi/1138IbnCabdHadiNurDinSindi.HashiyaCalaSahihBukhari/1138IbnCabdHadiNurDinSindi.HashiyaCalaSahihBukhari.ShamAY0035961-ara1"},
  {"id": "0676Nawawi.MinhajFiSharhMuslim.JK000137-ara1", "group": "shuruh", "en": "al-Minhāj: al-Nawawī on Muslim", "ar": "صحيح مسلم بشرح النووي", "authorAr": "النووي", "died": 676, "chars": 3172650, "commentsOn": "0261Muslim.Sahih.Shamela0001727-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0700AH/master/data/0676Nawawi/0676Nawawi.MinhajFiSharhMuslim/0676Nawawi.MinhajFiSharhMuslim.JK000137-ara1"},
  {"id": "0388AbuSulaymanKhattabi.MacalimSunan.Shamela0001442-ara1", "group": "shuruh", "en": "Maʿālim al-Sunan (al-Khaṭṭābī)", "ar": "معالم السنن، وهو شرح سنن أبي داود", "authorAr": "أبو سليمان حمد بن محمد بن إبراهيم بن الخطاب البستي المعروف بالخطابي (المتوفى: 388هـ)", "died": 388, "chars": 1330741, "commentsOn": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0400AH/master/data/0388AbuSulaymanKhattabi/0388AbuSulaymanKhattabi.MacalimSunan/0388AbuSulaymanKhattabi.MacalimSunan.Shamela0001442-ara1"},
  {"id": "1329MuhammadAshrafCazimabadi.CawnMacbud.JK000264-ara1", "group": "shuruh", "en": "ʿAwn al-Maʿbūd on Abū Dāwūd", "ar": "عون المعبود شرح سنن أبي داود", "authorAr": "محمد آبادي", "died": 1329, "chars": 4684512, "commentsOn": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1350AH/master/data/1329MuhammadAshrafCazimabadi/1329MuhammadAshrafCazimabadi.CawnMacbud/1329MuhammadAshrafCazimabadi.CawnMacbud.JK000264-ara1"},
  {"id": "1353IbnCabdRahimMubarakfuri.TuhfatAhwadhi.JK000201-ara1", "group": "shuruh", "en": "Tuḥfat al-Aḥwadhī on al-Tirmidhī", "ar": "تحفة الأحوذي بشرح جامع الترمذي", "authorAr": "المباركفوري", "died": 1353, "chars": 5575154, "commentsOn": "0279Tirmidhi.Sunan.JK000140-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1375AH/master/data/1353IbnCabdRahimMubarakfuri/1353IbnCabdRahimMubarakfuri.TuhfatAhwadhi/1353IbnCabdRahimMubarakfuri.TuhfatAhwadhi.JK000201-ara1"},
  {"id": "0911Suyuti.SharhSunanNasai.ShamAY0033910-ara1", "group": "shuruh", "en": "al-Suyūṭī and al-Sindī on al-Nasāʾī", "ar": "سنن النسائي بشرح السيوطي وحاشية السندي", "authorAr": "جلال الدين السيوطي", "died": 911, "chars": 1383575, "commentsOn": "0303Nasai.SunanSughra.JK000130-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0925AH/master/data/0911Suyuti/0911Suyuti.SharhSunanNasai/0911Suyuti.SharhSunanNasai.ShamAY0033910-ara1"},
  {"id": "1138IbnCabdHadiNurDinSindi.HashiyaCalaIbnMajah.Shamela0009810-ara1", "group": "shuruh", "en": "Ḥāshiyat al-Sindī on Ibn Mājah", "ar": "حاشية السندي على سنن ابن ماجه = كفاية الحاجة في شرح سنن ابن ماجه", "authorAr": "محمد بن عبد الهادي التتوي، أبو الحسن، نور الدين السندي (المتوفى: 1138هـ)", "died": 1138, "chars": 2045901, "commentsOn": "0273IbnMaja.Sunan.JK000141-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1150AH/master/data/1138IbnCabdHadiNurDinSindi/1138IbnCabdHadiNurDinSindi.HashiyaCalaIbnMajah/1138IbnCabdHadiNurDinSindi.HashiyaCalaIbnMajah.Shamela0009810-ara1"},
  {"id": "0321Tahawi.SharhMacaniAthar.JK000469-ara1", "group": "shuruh", "en": "Sharḥ Maʿānī al-Āthār (al-Ṭaḥāwī, Ḥanafī)", "ar": "شرح معاني الآثار", "authorAr": "الطحاوي", "died": 321, "chars": 2184017, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0325AH/master/data/0321Tahawi/0321Tahawi.SharhMacaniAthar/0321Tahawi.SharhMacaniAthar.JK000469-ara1"},
  {"id": "1323RashidAhmadGanguhi.KawkabDurri.Sham19Y0150962-ara1", "group": "deobandi", "en": "al-Kawkab al-Durrī (Gangohī) on al-Tirmidhī", "ar": "الكوكب الدري على جامع الترمذي", "authorAr": "رشيد الكنكوهي", "died": 1323, "chars": 945447, "commentsOn": "0279Tirmidhi.Sunan.JK000140-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1325AH/master/data/1323RashidAhmadGanguhi/1323RashidAhmadGanguhi.KawkabDurri/1323RashidAhmadGanguhi.KawkabDurri.Sham19Y0150962-ara1"},
  {"id": "1346KhalilAhmadSaharanpuri.BadhlMajhud.Sham19Y0014601-ara1", "group": "deobandi", "en": "Badhl al-Majhūd (Sahāranpūrī) on Abū Dāwūd", "ar": "بذل المجهود في حل سنن أبي داود", "authorAr": "خليل أحمد السهارنفوري", "died": 1346, "chars": 7346034, "commentsOn": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1350AH/master/data/1346KhalilAhmadSaharanpuri/1346KhalilAhmadSaharanpuri.BadhlMajhud/1346KhalilAhmadSaharanpuri.BadhlMajhud.Sham19Y0014601-ara1"},
  {"id": "1304CabdHayyLaknawi.TacliqMumajjad.Shamela0009804-ara1", "group": "deobandi", "en": "al-Taʿlīq al-Mumajjad (Lakhnawī) on the Muwaṭṭaʾ of Muḥammad", "ar": "التعليق الممجد على موطأ محمد (شرح لموطأ مالك برواية محمد بن الحسن)", "authorAr": "محمد عبد الحي بن محمد عبد الحليم الأنصاري اللكنوي الهندي، أبو الحسنات (المتوفى: 1304هـ)", "died": 1304, "chars": 413382, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1325AH/master/data/1304CabdHayyLaknawi/1304CabdHayyLaknawi.TacliqMumajjad/1304CabdHayyLaknawi.TacliqMumajjad.Shamela0009804-ara1"},
  {"id": "1304CabdHayyLaknawi.Sicaya.ShamAY0033177-ara1", "group": "deobandi", "en": "al-Siʿāya (Lakhnawī) on Sharḥ al-Wiqāya", "ar": "السعاية في كشف ما في شرح الوقاية", "authorAr": "محمد عبد الحي بن محمد عبد الحليم الأنصاري اللكنوي الهندي، أبو الحسنات", "died": 1304, "chars": 918564, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1325AH/master/data/1304CabdHayyLaknawi/1304CabdHayyLaknawi.Sicaya/1304CabdHayyLaknawi.Sicaya.ShamAY0033177-ara1"},
  {"id": "0428AbuHusaynQuduri.Mukhtasar.Sham19Y0124336-ara1", "group": "mutun", "en": "Mukhtaṣar al-Qudūrī", "ar": "مختصر القدوري", "authorAr": "أبو الحسين القدوري", "died": 428, "chars": 175553, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0450AH/master/data/0428AbuHusaynQuduri/0428AbuHusaynQuduri.Mukhtasar/0428AbuHusaynQuduri.Mukhtasar.Sham19Y0124336-ara1"},
  {"id": "0710IbnAhmadHafizDinNasafi.KanzDaqaiq.Sham19Y0014262-ara1", "group": "mutun", "en": "Kanz al-Daqāʾiq (al-Nasafī)", "ar": "كنز الدقائق", "authorAr": "أبو البركات عبد الله بن أحمد بن محمود حافظ الدين النسفي (المتوفى: 710ه)", "died": 710, "chars": 152285, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0725AH/master/data/0710IbnAhmadHafizDinNasafi/0710IbnAhmadHafizDinNasafi.KanzDaqaiq/0710IbnAhmadHafizDinNasafi.KanzDaqaiq.Sham19Y0014262-ara1"},
  {"id": "1069IbnCammarShurunbulali.NurIdah.JK000284-ara1", "group": "mutun", "en": "Nūr al-Īḍāḥ (al-Shurunbulālī)", "ar": "نور الإيضاح ونجاة الأرواح", "authorAr": "الشرنبلالي", "died": 1069, "chars": 85227, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1075AH/master/data/1069IbnCammarShurunbulali/1069IbnCammarShurunbulali.NurIdah/1069IbnCammarShurunbulali.NurIdah.JK000284-ara1"},
  {"id": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "group": "mutun", "en": "al-Hidāya (al-Marghīnānī)", "ar": "الهداية شرح البداية", "authorAr": "أبي الحسن علي بن أبي بكر بن عبد الجليل الرشداني المرغياني", "died": 593, "chars": 1451031, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0600AH/master/data/0593BurhanDinFarghaniMarghinani/0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya/0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1"},
  {"id": "1088IbnCaliHaskafi.DurrMukhtar.JK000176-ara1", "group": "mutun", "en": "al-Durr al-Mukhtār (al-Ḥaṣkafī)", "ar": "الدر المختار", "authorAr": "الحصكفي", "died": 1088, "chars": 1285162, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1100AH/master/data/1088IbnCaliHaskafi/1088IbnCaliHaskafi.DurrMukhtar/1088IbnCaliHaskafi.DurrMukhtar.JK000176-ara1"},
  {"id": "0683IbnMahmudMajdDinMawsili.IkhtiyarLiTaclil.JK009404-ara1", "group": "mutun", "en": "al-Ikhtiyār li-Taʿlīl al-Mukhtār (al-Mawṣilī)", "ar": "الاختيار لتعليل المختار", "authorAr": "ابن محمود مجد الدين الموصلي", "died": 683, "chars": 1164127, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0700AH/master/data/0683IbnMahmudMajdDinMawsili/0683IbnMahmudMajdDinMawsili.IkhtiyarLiTaclil/0683IbnMahmudMajdDinMawsili.IkhtiyarLiTaclil.JK009404-ara1"},
  {"id": "0786IbnMuhammadBabarti.CinayaSharhHidaya.JK011690BK2-ara1", "group": "fiqh-shuruh", "en": "al-ʿInāya on al-Hidāya (al-Bābartī)", "ar": "العناية شرح الهداية", "authorAr": "البابرتي", "died": 786, "chars": 3488134, "commentsOn": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0800AH/master/data/0786IbnMuhammadBabarti/0786IbnMuhammadBabarti.CinayaSharhHidaya/0786IbnMuhammadBabarti.CinayaSharhHidaya.JK011690BK2-ara1"},
  {"id": "0855BadrDinCayni.BinayaSharhHidaya.Shamela0000427BK2-ara1", "group": "fiqh-shuruh", "en": "al-Bināya on al-Hidāya (al-ʿAynī)", "ar": "البناية شرح الهداية", "authorAr": "بدر الدين العيني", "died": 855, "chars": 9212496, "commentsOn": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0855BadrDinCayni/0855BadrDinCayni.BinayaSharhHidaya/0855BadrDinCayni.BinayaSharhHidaya.Shamela0000427BK2-ara1"},
  {"id": "0861IbnHumam.FathQadir.Shamela0021744-ara1", "group": "fiqh-shuruh", "en": "Fatḥ al-Qadīr on al-Hidāya (Ibn al-Humām)", "ar": "فتح القدير", "authorAr": "الكمال ابن الهمام", "died": 861, "chars": 8681662, "commentsOn": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0861IbnHumam/0861IbnHumam.FathQadir/0861IbnHumam.FathQadir.Shamela0021744-ara1"},
  {"id": "0743FakhrDinZaylaci.TabyinHaqaiq.JK005200-ara1", "group": "fiqh-shuruh", "en": "Tabyīn al-Ḥaqāʾiq on Kanz al-Daqāʾiq (al-Zaylaʿī)", "ar": "تبيين الحقائق", "authorAr": "فخر الدين عثمان بن علي الزيلعي الحنفي.", "died": 743, "chars": 3712180, "commentsOn": "0710IbnAhmadHafizDinNasafi.KanzDaqaiq.Sham19Y0014262-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0750AH/master/data/0743FakhrDinZaylaci/0743FakhrDinZaylaci.TabyinHaqaiq/0743FakhrDinZaylaci.TabyinHaqaiq.JK005200-ara1"},
  {"id": "1252IbnCabidinDimashqi.RaddMukhtar.JK000170-ara1", "group": "fiqh-shuruh", "en": "Radd al-Muḥtār on al-Durr al-Mukhtār (Ibn ʿĀbidīn)", "ar": "حاشية ابن عابدين", "authorAr": "ابن عابدين", "died": 1252, "chars": 10330607, "commentsOn": "1088IbnCaliHaskafi.DurrMukhtar.JK000176-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1275AH/master/data/1252IbnCabidinDimashqi/1252IbnCabidinDimashqi.RaddMukhtar/1252IbnCabidinDimashqi.RaddMukhtar.JK000170-ara1"},
  {"id": "0483IbnAhmadSarakhsi.Mabsut.JK000266-ara1", "group": "fiqh-shuruh", "en": "al-Mabsūṭ (al-Sarakhsī)", "ar": "المبسوط للسرخسي", "authorAr": "ابن أحمد السرخسي", "died": 483, "chars": 10184443, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0500AH/master/data/0483IbnAhmadSarakhsi/0483IbnAhmadSarakhsi.Mabsut/0483IbnAhmadSarakhsi.Mabsut.JK000266-ara1"},
  {"id": "0587IbnMascudCalaDinKasani.BadaicSanaic.JK000150-ara1", "group": "fiqh-shuruh", "en": "Badāʾiʿ al-Ṣanāʾiʿ (al-Kāsānī)", "ar": "بدائع الصنائع في ترتيب الشرائع", "authorAr": "علاء الدين الكاساني", "died": 587, "chars": 6007018, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0600AH/master/data/0587IbnMascudCalaDinKasani/0587IbnMascudCalaDinKasani.BadaicSanaic/0587IbnMascudCalaDinKasani.BadaicSanaic.JK000150-ara1"},
];

export const ATTRIBUTION = 'Texts from the OpenITI corpus (Open Islamicate Texts Initiative), CC BY-NC-SA 4.0. Digitised from printed editions; check important passages against a printed copy.';

/** About how much a book is to download (the text is plain, so about 1.8 bytes a letter). */
export const sizeOf = (e: CatalogueEntry) => {
  const mb = (e.chars * 1.8) / 1_048_576;
  return mb < 1 ? `${Math.max(1, Math.round(mb * 1024))} KB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
};

/** Downloads a book from the catalogue into the library, linking it to its matn or commentaries. */
export async function download(e: CatalogueEntry, onProgress?: (done: number, total: number) => void): Promise<string> {
  const res = await fetch(e.url);
  if (!res.ok || !res.body) throw new Error(`The book could not be downloaded (${res.status}). Check your internet connection and try again.`);
  const total = Number(res.headers.get('content-length')) || Math.round(e.chars * 1.8);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.length;
    onProgress?.(done, total);
  }
  const { addFiles } = await import('../import');
  const [r] = await addFiles([new File(parts as BlobPart[], `${e.id}.mARkdown`, { type: 'text/markdown' })]);
  const id = r.bookId ?? r.duplicateOf?.id;
  if (!id) throw new Error(r.error ?? 'The book could not be added.');
  await db.books.update(id, { catalogueId: e.id, title: e.ar || undefined });
  await linkCommentaries();
  return id;
}

/** Commentaries from the catalogue are linked to their matn when both are in the library. */
export async function linkCommentaries(): Promise<void> {
  const books = (await db.books.toArray()).filter((b) => b.catalogueId);
  const byCat = new Map(books.map((b) => [b.catalogueId!, b] as const));
  for (const e of CATALOGUE) {
    if (!e.commentsOn) continue;
    const sharh = byCat.get(e.id);
    const matn = byCat.get(e.commentsOn);
    if (!sharh || !matn || matn.commentaries?.includes(sharh.id)) continue;
    await db.books.update(matn.id, { commentaries: [...(matn.commentaries ?? []), sharh.id] });
    matn.commentaries = [...(matn.commentaries ?? []), sharh.id];
  }
}

/** The books of the catalogue already in the library. */
export async function inLibrary(): Promise<Map<string, Book>> {
  return new Map((await db.books.toArray()).filter((b) => b.catalogueId).map((b) => [b.catalogueId!, b] as const));
}
