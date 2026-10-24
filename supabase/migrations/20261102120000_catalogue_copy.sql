-- Catalogue copy that described the games inaccurately or read oddly.
--
--   - Memory Flash: the flash starts at 700 ms and gets shorter every round, so
--     "half a second" was wrong from the first pattern.
--   - Color Merge: "Fill nothing." read as a typo; the tagline now says what the
--     player does.
--   - 7 Second: only signed-in players are limited to one ranked attempt a day;
--     guests can practise as often as they like.
update public.games
   set description = 'A pattern flashes for a moment, a little shorter every round. Rebuild it cell by cell.'
 where slug = 'memory-flash';

update public.games
   set tagline = 'Slide, merge, keep the board open.'
 where slug = 'color-merge';

update public.games
   set description = 'A new micro challenge every day. Signed-in players get one ranked attempt a day; anyone can practise as often as they like.'
 where slug = '7-second';
