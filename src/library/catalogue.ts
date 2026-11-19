import { db } from '../db/db';
import type { Book } from '../db/types';

/**
 * Classical books ready to download, from the OpenITI corpus (Open Islamicate Texts
 * Initiative; texts under CC BY-NC-SA 4.0: free to read and share, with attribution, not
 * for sale). Each is fetched straight from OpenITI's own repository when tapped, and
 * comes into the library like any other book. A commentary is linked to its matn, so
 * "In the commentary" knows where to go.
 */

export type CatalogueGroup = 'six' | 'shuruh' | 'deobandi' | 'mutun' | 'fiqh-shuruh' | 'siyasa';

export const GROUPS: Array<{ id: CatalogueGroup; title: string; sub: string }> = [
  { id: 'six', title: 'The six books of ḥadīth', sub: 'al-Kutub al-Sitta' },
  { id: 'shuruh', title: 'Their commentaries: classical', sub: 'Shurūḥ al-ḥadīth' },
  { id: 'deobandi', title: 'Commentaries: Deobandi and Indian Ḥanafī', sub: 'Gangohī, Sahāranpūrī, Lakhnawī' },
  { id: 'mutun', title: 'Ḥanafī fiqh: the main texts', sub: 'Mutūn' },
  { id: 'fiqh-shuruh', title: 'Ḥanafī fiqh: commentaries and great works', sub: 'Shurūḥ and mabsūṭāt' },
  { id: 'siyasa', title: 'Islamic government and the constitution: classical works', sub: 'al-Aḥkām al-Sulṭāniyya and al-Siyāsa al-Sharʿiyya' },
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
  {"id": "0256Bukhari.Sahih.JK000110-ara1", "group": "six", "en": "Ṣaḥīḥ al-Bukhārī", "ar": "صحيح البخاري", "authorAr": "البخاري", "died": 256, "chars": 2349294, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0256Bukhari/0256Bukhari.Sahih/0256Bukhari.Sahih.JK000110-ara1.completed"},
  {"id": "0261Muslim.Sahih.Shamela0001727-ara1", "group": "six", "en": "Ṣaḥīḥ Muslim", "ar": "صحيح مسلم", "authorAr": "مسلم", "died": 261, "chars": 1945463, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0261Muslim/0261Muslim.Sahih/0261Muslim.Sahih.Shamela0001727-ara1.mARkdown"},
  {"id": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "group": "six", "en": "Sunan Abī Dāwūd", "ar": "سنن أبي داود", "authorAr": "سليمان بن الأشعث أبو داود السجستاني الأزدي", "died": 275, "chars": 1341565, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0275AbuDawudSijistani/0275AbuDawudSijistani.Sunan/0275AbuDawudSijistani.Sunan.JK000142-ara1"},
  {"id": "0279Tirmidhi.Sunan.JK000140-ara1", "group": "six", "en": "Jāmiʿ al-Tirmidhī", "ar": "جامع الترمذي", "authorAr": "محمد بن عيسى أبو عيسى الترمذي السلمي", "died": 279, "chars": 1464470, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0300AH/master/data/0279Tirmidhi/0279Tirmidhi.Sunan/0279Tirmidhi.Sunan.JK000140-ara1.completed"},
  {"id": "0303Nasai.SunanSughra.JK000130-ara1", "group": "six", "en": "Sunan al-Nasāʾī", "ar": "سنن النسائي (المجتبى)", "authorAr": "النسائي", "died": 303, "chars": 1388342, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0325AH/master/data/0303Nasai/0303Nasai.SunanSughra/0303Nasai.SunanSughra.JK000130-ara1.mARkdown"},
  {"id": "0273IbnMaja.Sunan.JK000141-ara1", "group": "six", "en": "Sunan Ibn Mājah", "ar": "سنن ابن ماجه", "authorAr": "محمد بن يزيد أبو عبدالله القزويني", "died": 273, "chars": 979610, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0275AH/master/data/0273IbnMaja/0273IbnMaja.Sunan/0273IbnMaja.Sunan.JK000141-ara1"},
  {"id": "0852IbnHajarCasqalani.FathBari.JK000166-ara1", "group": "shuruh", "en": "Fatḥ al-Bārī (Ibn Ḥajar)", "ar": "فتح الباري", "authorAr": "ابن حجر العسقلاني", "died": 852, "chars": 13295094, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0852IbnHajarCasqalani/0852IbnHajarCasqalani.FathBari/0852IbnHajarCasqalani.FathBari.JK000166-ara1"},
  {"id": "0855BadrDinCayni.CumdatQari.Shamela0005756-ara1", "group": "shuruh", "en": "ʿUmdat al-Qārī (al-ʿAynī, Ḥanafī)", "ar": "عمدة القاري شرح صحيح البخاري", "authorAr": "بدر الدين العيني", "died": 855, "chars": 19001707, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0855BadrDinCayni/0855BadrDinCayni.CumdatQari/0855BadrDinCayni.CumdatQari.Shamela0005756-ara1.completed"},
  {"id": "0923AhmadQastallani.IrshadSari.Shamela0021715-ara1", "group": "shuruh", "en": "Irshād al-Sārī (al-Qasṭallānī)", "ar": "ارشاد الساري لشرح صحيح البخاري", "authorAr": "القسطلاني", "died": 923, "chars": 14017528, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0925AH/master/data/0923AhmadQastallani/0923AhmadQastallani.IrshadSari/0923AhmadQastallani.IrshadSari.Shamela0021715-ara1.mARkdown"},
  {"id": "1138IbnCabdHadiNurDinSindi.HashiyaCalaSahihBukhari.ShamAY0035961-ara1", "group": "shuruh", "en": "Ḥāshiyat al-Sindī on al-Bukhārī", "ar": "حاشية السندي على صحيح البخاري", "authorAr": "محمد بن عبد الهادي التتوي، أبو الحسن، نور الدين السندي", "died": 1138, "chars": 637191, "commentsOn": "0256Bukhari.Sahih.JK000110-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1150AH/master/data/1138IbnCabdHadiNurDinSindi/1138IbnCabdHadiNurDinSindi.HashiyaCalaSahihBukhari/1138IbnCabdHadiNurDinSindi.HashiyaCalaSahihBukhari.ShamAY0035961-ara1"},
  {"id": "0676Nawawi.MinhajFiSharhMuslim.JK000137-ara1", "group": "shuruh", "en": "al-Minhāj: al-Nawawī on Muslim", "ar": "المنهاج شرح صحيح مسلم", "authorAr": "النووي", "died": 676, "chars": 3172650, "commentsOn": "0261Muslim.Sahih.Shamela0001727-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0700AH/master/data/0676Nawawi/0676Nawawi.MinhajFiSharhMuslim/0676Nawawi.MinhajFiSharhMuslim.JK000137-ara1"},
  {"id": "0388AbuSulaymanKhattabi.MacalimSunan.Shamela0001442-ara1", "group": "shuruh", "en": "Maʿālim al-Sunan (al-Khaṭṭābī)", "ar": "معالم السنن", "authorAr": "أبو سليمان حمد بن محمد بن إبراهيم بن الخطاب البستي المعروف بالخطابي (المتوفى: 388هـ)", "died": 388, "chars": 1330741, "commentsOn": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0400AH/master/data/0388AbuSulaymanKhattabi/0388AbuSulaymanKhattabi.MacalimSunan/0388AbuSulaymanKhattabi.MacalimSunan.Shamela0001442-ara1"},
  {"id": "1329MuhammadAshrafCazimabadi.CawnMacbud.JK000264-ara1", "group": "shuruh", "en": "ʿAwn al-Maʿbūd on Abū Dāwūd", "ar": "عون المعبود شرح سنن أبي داود", "authorAr": "محمد آبادي", "died": 1329, "chars": 4684512, "commentsOn": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1350AH/master/data/1329MuhammadAshrafCazimabadi/1329MuhammadAshrafCazimabadi.CawnMacbud/1329MuhammadAshrafCazimabadi.CawnMacbud.JK000264-ara1"},
  {"id": "1353IbnCabdRahimMubarakfuri.TuhfatAhwadhi.JK000201-ara1", "group": "shuruh", "en": "Tuḥfat al-Aḥwadhī on al-Tirmidhī", "ar": "تحفة الأحوذي بشرح جامع الترمذي", "authorAr": "المباركفوري", "died": 1353, "chars": 5575154, "commentsOn": "0279Tirmidhi.Sunan.JK000140-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1375AH/master/data/1353IbnCabdRahimMubarakfuri/1353IbnCabdRahimMubarakfuri.TuhfatAhwadhi/1353IbnCabdRahimMubarakfuri.TuhfatAhwadhi.JK000201-ara1"},
  {"id": "0911Suyuti.SharhSunanNasai.ShamAY0033910-ara1", "group": "shuruh", "en": "al-Suyūṭī and al-Sindī on al-Nasāʾī", "ar": "شرح السيوطي وحاشية السندي على سنن النسائي", "authorAr": "جلال الدين السيوطي", "died": 911, "chars": 1383575, "commentsOn": "0303Nasai.SunanSughra.JK000130-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0925AH/master/data/0911Suyuti/0911Suyuti.SharhSunanNasai/0911Suyuti.SharhSunanNasai.ShamAY0033910-ara1"},
  {"id": "1138IbnCabdHadiNurDinSindi.HashiyaCalaIbnMajah.Shamela0009810-ara1", "group": "shuruh", "en": "Ḥāshiyat al-Sindī on Ibn Mājah", "ar": "حاشية السندي على سنن ابن ماجه", "authorAr": "محمد بن عبد الهادي التتوي، أبو الحسن، نور الدين السندي (المتوفى: 1138هـ)", "died": 1138, "chars": 2045901, "commentsOn": "0273IbnMaja.Sunan.JK000141-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1150AH/master/data/1138IbnCabdHadiNurDinSindi/1138IbnCabdHadiNurDinSindi.HashiyaCalaIbnMajah/1138IbnCabdHadiNurDinSindi.HashiyaCalaIbnMajah.Shamela0009810-ara1"},
  {"id": "0321Tahawi.SharhMacaniAthar.JK000469-ara1", "group": "shuruh", "en": "Sharḥ Maʿānī al-Āthār (al-Ṭaḥāwī, Ḥanafī)", "ar": "شرح معاني الآثار", "authorAr": "الطحاوي", "died": 321, "chars": 2184017, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0325AH/master/data/0321Tahawi/0321Tahawi.SharhMacaniAthar/0321Tahawi.SharhMacaniAthar.JK000469-ara1"},
  {"id": "1323RashidAhmadGanguhi.KawkabDurri.Sham19Y0150962-ara1", "group": "deobandi", "en": "al-Kawkab al-Durrī (Gangohī) on al-Tirmidhī", "ar": "الكوكب الدري على جامع الترمذي", "authorAr": "رشيد الكنكوهي", "died": 1323, "chars": 945447, "commentsOn": "0279Tirmidhi.Sunan.JK000140-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1325AH/master/data/1323RashidAhmadGanguhi/1323RashidAhmadGanguhi.KawkabDurri/1323RashidAhmadGanguhi.KawkabDurri.Sham19Y0150962-ara1"},
  {"id": "1346KhalilAhmadSaharanpuri.BadhlMajhud.Sham19Y0014601-ara1", "group": "deobandi", "en": "Badhl al-Majhūd (Sahāranpūrī) on Abū Dāwūd", "ar": "بذل المجهود في حل سنن أبي داود", "authorAr": "خليل أحمد السهارنفوري", "died": 1346, "chars": 7346034, "commentsOn": "0275AbuDawudSijistani.Sunan.JK000142-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1350AH/master/data/1346KhalilAhmadSaharanpuri/1346KhalilAhmadSaharanpuri.BadhlMajhud/1346KhalilAhmadSaharanpuri.BadhlMajhud.Sham19Y0014601-ara1"},
  {"id": "1304CabdHayyLaknawi.TacliqMumajjad.Shamela0009804-ara1", "group": "deobandi", "en": "al-Taʿlīq al-Mumajjad (Lakhnawī) on the Muwaṭṭaʾ of Muḥammad", "ar": "التعليق الممجد على موطأ محمد", "authorAr": "محمد عبد الحي بن محمد عبد الحليم الأنصاري اللكنوي الهندي، أبو الحسنات (المتوفى: 1304هـ)", "died": 1304, "chars": 413382, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1325AH/master/data/1304CabdHayyLaknawi/1304CabdHayyLaknawi.TacliqMumajjad/1304CabdHayyLaknawi.TacliqMumajjad.Shamela0009804-ara1"},
  {"id": "1304CabdHayyLaknawi.Sicaya.ShamAY0033177-ara1", "group": "deobandi", "en": "al-Siʿāya (Lakhnawī) on Sharḥ al-Wiqāya", "ar": "السعاية في كشف ما في شرح الوقاية", "authorAr": "محمد عبد الحي بن محمد عبد الحليم الأنصاري اللكنوي الهندي، أبو الحسنات", "died": 1304, "chars": 918564, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1325AH/master/data/1304CabdHayyLaknawi/1304CabdHayyLaknawi.Sicaya/1304CabdHayyLaknawi.Sicaya.ShamAY0033177-ara1"},
  {"id": "0428AbuHusaynQuduri.Mukhtasar.Sham19Y0124336-ara1", "group": "mutun", "en": "Mukhtaṣar al-Qudūrī", "ar": "مختصر القدوري", "authorAr": "أبو الحسين القدوري", "died": 428, "chars": 175553, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0450AH/master/data/0428AbuHusaynQuduri/0428AbuHusaynQuduri.Mukhtasar/0428AbuHusaynQuduri.Mukhtasar.Sham19Y0124336-ara1"},
  {"id": "0710IbnAhmadHafizDinNasafi.KanzDaqaiq.Sham19Y0014262-ara1", "group": "mutun", "en": "Kanz al-Daqāʾiq (al-Nasafī)", "ar": "كنز الدقائق", "authorAr": "أبو البركات عبد الله بن أحمد بن محمود حافظ الدين النسفي (المتوفى: 710ه)", "died": 710, "chars": 152285, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0725AH/master/data/0710IbnAhmadHafizDinNasafi/0710IbnAhmadHafizDinNasafi.KanzDaqaiq/0710IbnAhmadHafizDinNasafi.KanzDaqaiq.Sham19Y0014262-ara1"},
  {"id": "1069IbnCammarShurunbulali.NurIdah.JK000284-ara1", "group": "mutun", "en": "Nūr al-Īḍāḥ (al-Shurunbulālī)", "ar": "نور الإيضاح ونجاة الأرواح", "authorAr": "الشرنبلالي", "died": 1069, "chars": 85227, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1075AH/master/data/1069IbnCammarShurunbulali/1069IbnCammarShurunbulali.NurIdah/1069IbnCammarShurunbulali.NurIdah.JK000284-ara1"},
  {"id": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "group": "mutun", "en": "al-Hidāya (al-Marghīnānī)", "ar": "الهداية شرح بداية المبتدي", "authorAr": "أبي الحسن علي بن أبي بكر بن عبد الجليل الرشداني المرغياني", "died": 593, "chars": 1451031, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0600AH/master/data/0593BurhanDinFarghaniMarghinani/0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya/0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1"},
  {"id": "1088IbnCaliHaskafi.DurrMukhtar.JK000176-ara1", "group": "mutun", "en": "al-Durr al-Mukhtār (al-Ḥaṣkafī)", "ar": "الدر المختار", "authorAr": "الحصكفي", "died": 1088, "chars": 1285162, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/1100AH/master/data/1088IbnCaliHaskafi/1088IbnCaliHaskafi.DurrMukhtar/1088IbnCaliHaskafi.DurrMukhtar.JK000176-ara1"},
  {"id": "0683IbnMahmudMajdDinMawsili.IkhtiyarLiTaclil.JK009404-ara1", "group": "mutun", "en": "al-Ikhtiyār li-Taʿlīl al-Mukhtār (al-Mawṣilī)", "ar": "الاختيار لتعليل المختار", "authorAr": "ابن محمود مجد الدين الموصلي", "died": 683, "chars": 1164127, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0700AH/master/data/0683IbnMahmudMajdDinMawsili/0683IbnMahmudMajdDinMawsili.IkhtiyarLiTaclil/0683IbnMahmudMajdDinMawsili.IkhtiyarLiTaclil.JK009404-ara1"},
  {"id": "0786IbnMuhammadBabarti.CinayaSharhHidaya.JK011690BK2-ara1", "group": "fiqh-shuruh", "en": "al-ʿInāya on al-Hidāya (al-Bābartī)", "ar": "العناية شرح الهداية", "authorAr": "البابرتي", "died": 786, "chars": 3488134, "commentsOn": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0800AH/master/data/0786IbnMuhammadBabarti/0786IbnMuhammadBabarti.CinayaSharhHidaya/0786IbnMuhammadBabarti.CinayaSharhHidaya.JK011690BK2-ara1"},
  {"id": "0855BadrDinCayni.BinayaSharhHidaya.Shamela0000427BK2-ara1", "group": "fiqh-shuruh", "en": "al-Bināya on al-Hidāya (al-ʿAynī)", "ar": "البناية شرح الهداية", "authorAr": "بدر الدين العيني", "died": 855, "chars": 9212496, "commentsOn": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0855BadrDinCayni/0855BadrDinCayni.BinayaSharhHidaya/0855BadrDinCayni.BinayaSharhHidaya.Shamela0000427BK2-ara1"},
  {"id": "0861IbnHumam.FathQadir.Shamela0021744-ara1", "group": "fiqh-shuruh", "en": "Fatḥ al-Qadīr on al-Hidāya (Ibn al-Humām)", "ar": "فتح القدير", "authorAr": "الكمال ابن الهمام", "died": 861, "chars": 8681662, "commentsOn": "0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0875AH/master/data/0861IbnHumam/0861IbnHumam.FathQadir/0861IbnHumam.FathQadir.Shamela0021744-ara1"},
  {"id": "0743FakhrDinZaylaci.TabyinHaqaiq.JK005200-ara1", "group": "fiqh-shuruh", "en": "Tabyīn al-Ḥaqāʾiq on Kanz al-Daqāʾiq (al-Zaylaʿī)", "ar": "تبيين الحقائق شرح كنز الدقائق", "authorAr": "فخر الدين عثمان بن علي الزيلعي الحنفي.", "died": 743, "chars": 3712180, "commentsOn": "0710IbnAhmadHafizDinNasafi.KanzDaqaiq.Sham19Y0014262-ara1", "url": "https://raw.githubusercontent.com/OpenITI/0750AH/master/data/0743FakhrDinZaylaci/0743FakhrDinZaylaci.TabyinHaqaiq/0743FakhrDinZaylaci.TabyinHaqaiq.JK005200-ara1"},
  {"id": "1252IbnCabidinDimashqi.RaddMukhtar.JK000170-ara1", "group": "fiqh-shuruh", "en": "Radd al-Muḥtār on al-Durr al-Mukhtār (Ibn ʿĀbidīn)", "ar": "رد المحتار على الدر المختار", "authorAr": "ابن عابدين", "died": 1252, "chars": 10330607, "commentsOn": "1088IbnCaliHaskafi.DurrMukhtar.JK000176-ara1", "url": "https://raw.githubusercontent.com/OpenITI/1275AH/master/data/1252IbnCabidinDimashqi/1252IbnCabidinDimashqi.RaddMukhtar/1252IbnCabidinDimashqi.RaddMukhtar.JK000170-ara1"},
  {"id": "0483IbnAhmadSarakhsi.Mabsut.JK000266-ara1", "group": "fiqh-shuruh", "en": "al-Mabsūṭ (al-Sarakhsī)", "ar": "المبسوط للسرخسي", "authorAr": "ابن أحمد السرخسي", "died": 483, "chars": 10184443, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0500AH/master/data/0483IbnAhmadSarakhsi/0483IbnAhmadSarakhsi.Mabsut/0483IbnAhmadSarakhsi.Mabsut.JK000266-ara1"},
  {"id": "0587IbnMascudCalaDinKasani.BadaicSanaic.JK000150-ara1", "group": "fiqh-shuruh", "en": "Badāʾiʿ al-Ṣanāʾiʿ (al-Kāsānī)", "ar": "بدائع الصنائع في ترتيب الشرائع", "authorAr": "علاء الدين الكاساني", "died": 587, "chars": 6007018, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0600AH/master/data/0587IbnMascudCalaDinKasani/0587IbnMascudCalaDinKasani.BadaicSanaic/0587IbnMascudCalaDinKasani.BadaicSanaic.JK000150-ara1"},
  {"id": "0450AbuHasanMawardi.AhkamSultaniyya.Shamela0022881-ara1", "group": "siyasa", "en": "al-Aḥkām al-Sulṭāniyya (al-Māwardī)", "ar": "الأحكام السلطانية للماوردي", "authorAr": "الماوردي", "died": 450, "chars": 359629, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0450AH/master/data/0450AbuHasanMawardi/0450AbuHasanMawardi.AhkamSultaniyya/0450AbuHasanMawardi.AhkamSultaniyya.Shamela0022881-ara1.mARkdown"},
  {"id": "0458AbuYaclaIbnFarra.AhkamSultaniyya.Shamela0022877-ara1", "group": "siyasa", "en": "al-Aḥkām al-Sulṭāniyya (Abū Yaʿlā, Ḥanbalī)", "ar": "الأحكام السلطانية لأبي يعلى", "authorAr": "ابن الفراء", "died": 458, "chars": 311344, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0475AH/master/data/0458AbuYaclaIbnFarra/0458AbuYaclaIbnFarra.AhkamSultaniyya/0458AbuYaclaIbnFarra.AhkamSultaniyya.Shamela0022877-ara1.mARkdown"},
  {"id": "0478ImamHaramaynJuwayni.GhiyathUmam.JK000043-ara1", "group": "siyasa", "en": "Ghiyāth al-Umam (al-Juwaynī)", "ar": "غياث الأمم في التياث الظلم", "authorAr": "امام الحرمين الجويني", "died": 478, "chars": 264357, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0500AH/master/data/0478ImamHaramaynJuwayni/0478ImamHaramaynJuwayni.GhiyathUmam/0478ImamHaramaynJuwayni.GhiyathUmam.JK000043-ara1"},
  {"id": "0728IbnTaymiyya.SiyasaSharciyya.JK000008-ara1", "group": "siyasa", "en": "al-Siyāsa al-Sharʿiyya (Ibn Taymiyya)", "ar": "السياسة الشرعية في إصلاح الراعي والرعية", "authorAr": "ابن تيمية", "died": 728, "chars": 114827, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0750AH/master/data/0728IbnTaymiyya/0728IbnTaymiyya.SiyasaSharciyya/0728IbnTaymiyya.SiyasaSharciyya.JK000008-ara1"},
  {"id": "0733IbnJamacaBadrDinHamawi.TahrirAhkam.Shamela0009685-ara1", "group": "siyasa", "en": "Taḥrīr al-Aḥkām fī Tadbīr Ahl al-Islām (Ibn Jamāʿa)", "ar": "تحرير الأحكام في تدبير أهل الإسلام", "authorAr": "أبو عبد الله، محمد بن إبراهيم بن سعد الله بن جماعة الكناني الحموي الشافعي، بدر الدين (المتوفى: 733هـ)", "died": 733, "chars": 103531, "commentsOn": null, "url": "https://raw.githubusercontent.com/OpenITI/0750AH/master/data/0733IbnJamacaBadrDinHamawi/0733IbnJamacaBadrDinHamawi.TahrirAhkam/0733IbnJamacaBadrDinHamawi.TahrirAhkam.Shamela0009685-ara1"},
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

// ------------------------------------------------------------------------------- constitutions

/**
 * The constitutions of Muslim-majority countries (and of Nigeria, Lebanon and Bosnia,
 * about half Muslim), from the Constitute Project (CC BY-NC 3.0): English, and the
 * original Arabic where it is given. Converted once into books and kept with Maktaba's
 * own files, from where they are downloaded on a tap.
 */
export interface Constitution {
  id: string;
  country: string;
  short: string;
  year: string | null;
  langs: Array<'en' | 'ar'>;
  words: number | null;
  /** False: suspended or replaced since this text (the latest Constitute has). */
  inForce: boolean;
}

export const CONSTITUTIONS: Constitution[] = [
  {"id": "Afghanistan_2004", "country": "The Islamic Republic of Afghanistan", "short": "Afghanistan", "year": "2004", "langs": ["en"], "words": 10390, "inForce": true},
  {"id": "Albania_2016", "country": "Republic of Albania", "short": "Albania", "year": "1998", "langs": ["en"], "words": 23186, "inForce": true},
  {"id": "Algeria_2020", "country": "People's Democratic Republic of Algeria", "short": "Algeria", "year": "2020", "langs": ["en"], "words": null, "inForce": true},
  {"id": "Azerbaijan_2016", "country": "Republic of Azerbaijan", "short": "Azerbaijan", "year": "1995", "langs": ["en"], "words": 18398, "inForce": true},
  {"id": "Bahrain_2017", "country": "Kingdom of Bahrain", "short": "Bahrain", "year": "2002", "langs": ["en"], "words": 11366, "inForce": true},
  {"id": "Bangladesh_2018", "country": "People's Republic of Bangladesh", "short": "Bangladesh", "year": "1972", "langs": ["en"], "words": 25830, "inForce": true},
  {"id": "Bosnia_Herzegovina_2009", "country": "Bosnia and Herzegovina", "short": "Bosnia/Herzegov", "year": "1995", "langs": ["en"], "words": 5339, "inForce": true},
  {"id": "Brunei_2006", "country": "Brunei Darussalam", "short": "Brunei", "year": "1959", "langs": ["en"], "words": 16293, "inForce": true},
  {"id": "Burkina_Faso_2015", "country": "Burkina Faso", "short": "Burkina Faso", "year": "1991", "langs": ["en"], "words": 12042, "inForce": false},
  {"id": "Chad_2018", "country": "Republic of Chad", "short": "Chad", "year": "2018", "langs": ["en"], "words": 12505, "inForce": false},
  {"id": "Comoros_2018", "country": "Union of the Comoros", "short": "Comoros", "year": "2018", "langs": ["en"], "words": 6952, "inForce": true},
  {"id": "Djibouti_2010", "country": "Republic of Djibouti", "short": "Djibouti", "year": "1992", "langs": ["en"], "words": 6351, "inForce": true},
  {"id": "Egypt_2019", "country": "Arab Republic of Egypt", "short": "Egypt", "year": "2014", "langs": ["en", "ar"], "words": 21306, "inForce": true},
  {"id": "Gambia_2018", "country": "Republic of the Gambia", "short": "Gambia", "year": "1996", "langs": ["en"], "words": 41503, "inForce": true},
  {"id": "Guinea_2010", "country": "Republic of Guinea", "short": "Guinea", "year": "2010", "langs": ["en"], "words": 12612, "inForce": false},
  {"id": "Indonesia_2002", "country": "Republic of Indonesia", "short": "Indonesia", "year": "1945", "langs": ["en", "ar"], "words": 5913, "inForce": true},
  {"id": "Iran_1989", "country": "Islamic Republic of Iran", "short": "Iran", "year": "1979", "langs": ["en", "ar"], "words": 16177, "inForce": true},
  {"id": "Iraq_2005", "country": "Republic of Iraq", "short": "Iraq", "year": "2005", "langs": ["en", "ar"], "words": 11553, "inForce": true},
  {"id": "Jordan_2016", "country": "Hashemite Kingdom of Jordan", "short": "Jordan", "year": "1952", "langs": ["en", "ar"], "words": 10459, "inForce": true},
  {"id": "Kazakhstan_2026", "country": "Republic of Kazakhstan", "short": "Kazakhstan", "year": "2026", "langs": ["en"], "words": null, "inForce": true},
  {"id": "Kosovo_2020", "country": "Republic of Kosovo", "short": "Kosovo", "year": "2008", "langs": ["en"], "words": 22568, "inForce": true},
  {"id": "Kuwait_1992", "country": "State of Kuwait", "short": "Kuwait", "year": "1962", "langs": ["en", "ar"], "words": 8246, "inForce": true},
  {"id": "Kyrgyz_Republic_2021", "country": "Kyrgyz Republic", "short": "Kyrgyzstan", "year": "2021", "langs": ["en"], "words": null, "inForce": true},
  {"id": "Lebanon_2004", "country": "Lebanese Republic", "short": "Lebanon", "year": "1926", "langs": ["en", "ar"], "words": 6265, "inForce": true},
  {"id": "Libya_2012", "country": "Libya", "short": "Libya", "year": "2011", "langs": ["en", "ar"], "words": 2999, "inForce": true},
  {"id": "Malaysia_2025", "country": "Malaysia", "short": "Malaysia", "year": "1957", "langs": ["en"], "words": 65110, "inForce": true},
  {"id": "Maldives_2008", "country": "Republic of Maldives", "short": "Maldives", "year": "2008", "langs": ["en"], "words": 23992, "inForce": true},
  {"id": "Mali_2023", "country": "Republic of Mali", "short": "Mali", "year": "2023", "langs": ["en"], "words": null, "inForce": true},
  {"id": "Mauritania_2012", "country": "Islamic Republic of Mauritania", "short": "Mauritania", "year": "1991", "langs": ["en"], "words": 7635, "inForce": true},
  {"id": "Morocco_2011", "country": "Kingdom of Morocco", "short": "Morocco", "year": "2011", "langs": ["en", "ar"], "words": 15852, "inForce": true},
  {"id": "Niger_2017", "country": "Republic of the Niger", "short": "Niger", "year": "2010", "langs": ["en"], "words": 14624, "inForce": true},
  {"id": "Nigeria_2023", "country": "Federal Republic of Nigeria", "short": "Nigeria", "year": "1999", "langs": ["en"], "words": 67428, "inForce": true},
  {"id": "Oman_2011", "country": "Sultanate of Oman", "short": "Oman", "year": "1996", "langs": ["en"], "words": 7561, "inForce": false},
  {"id": "Pakistan_2018", "country": "Islamic Republic of Pakistan", "short": "Pakistan", "year": "1973", "langs": ["en", "ar"], "words": 57805, "inForce": true},
  {"id": "Palestine_2005", "country": "Palestine", "short": "Palestine", "year": "2003", "langs": ["en"], "words": 8507, "inForce": true},
  {"id": "Qatar_2003", "country": "State of Qatar", "short": "Qatar", "year": "2003", "langs": ["en"], "words": 6848, "inForce": true},
  {"id": "Saudi_Arabia_2013", "country": "Kingdom of Saudi Arabia", "short": "Saudi Arabia", "year": "1992", "langs": ["en"], "words": 6772, "inForce": true},
  {"id": "Senegal_2016", "country": "Republic of Senegal", "short": "Senegal", "year": "2001", "langs": ["en"], "words": 9982, "inForce": true},
  {"id": "Sierra_Leone_2022", "country": "Republic of Sierra Leone", "short": "Sierra Leone", "year": "1991", "langs": ["en"], "words": 44530, "inForce": true},
  {"id": "Somalia_2012", "country": "Somali Republic", "short": "Somalia", "year": "2012", "langs": ["en"], "words": 21725, "inForce": true},
  {"id": "Sudan_2020", "country": "Republic of the Sudan", "short": "Sudan", "year": "2019", "langs": ["en"], "words": 8309, "inForce": true},
  {"id": "Syria_2012", "country": "Syrian Arab Republic", "short": "Syria", "year": "2012", "langs": ["en", "ar"], "words": 8186, "inForce": false},
  {"id": "Tajikistan_2016", "country": "Republic of Tajikistan", "short": "Tajikistan", "year": "1994", "langs": ["en"], "words": 8258, "inForce": true},
  {"id": "Tunisia_2022", "country": "Republic of Tunisia", "short": "Tunisia", "year": "2022", "langs": ["en"], "words": 8977, "inForce": true},
  {"id": "Turkey_2017", "country": "Republic of Turkey", "short": "Turkey", "year": "1982", "langs": ["en", "ar"], "words": 31608, "inForce": true},
  {"id": "Turkmenistan_2016", "country": "Turkmenistan", "short": "Turkmenistan", "year": "2008", "langs": ["en"], "words": 7408, "inForce": true},
  {"id": "United_Arab_Emirates_2009", "country": "United Arab Emirates", "short": "UAE", "year": "1971", "langs": ["en", "ar"], "words": 10347, "inForce": true},
  {"id": "Uzbekistan_2023", "country": "Republic of Uzbekistan", "short": "Uzbekistan", "year": "2023", "langs": ["en"], "words": null, "inForce": true},
  {"id": "Yemen_2015", "country": "Republic of Yemen", "short": "Yemen", "year": "1991", "langs": ["en", "ar"], "words": 11913, "inForce": true},
];

export const CONSTITUTION_ATTRIBUTION = 'Constitutions from the Constitute Project (constituteproject.org), CC BY-NC 3.0, as published there, in English translation (and Arabic where given). Recent amendments may be missing: check the official text before relying on it.';

const CONSTITUTION_BASE = 'https://raw.githubusercontent.com/primephones/maktaba/HEAD/data/constitutions/';
export const constitutionKey = (c: Constitution, lang: 'en' | 'ar') => `constitution:${c.id}:${lang}`;

/** Downloads a constitution into the library (into a folder of its own, "Constitutions"). */
export async function downloadConstitution(c: Constitution, lang: 'en' | 'ar'): Promise<string> {
  const res = await fetch(`${CONSTITUTION_BASE}${c.id}.${lang}.md`);
  if (!res.ok) throw new Error(`The constitution could not be downloaded (${res.status}). Check your internet connection and try again.`);
  const text = await res.text();
  const { addFiles } = await import('../import');
  const [r] = await addFiles([new File([text], `${c.id}.${lang}.md`, { type: 'text/markdown' })]);
  const id = r.bookId ?? r.duplicateOf?.id;
  if (!id) throw new Error(r.error ?? 'The constitution could not be added.');
  let folder = await db.folders.filter((f) => f.name === 'Constitutions' && !f.parentId).first();
  if (!folder) {
    folder = { id: crypto.randomUUID(), name: 'Constitutions', createdAt: Date.now() };
    await db.folders.add(folder);
  }
  await db.books.update(id, {
    catalogueId: constitutionKey(c, lang),
    folderId: folder.id,
    lang,
  });
  return id;
}
