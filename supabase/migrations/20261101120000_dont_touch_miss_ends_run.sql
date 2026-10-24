-- Don't Touch the Black: a white tile that passes the line ends the run.
--
-- The rules the server verifies do not change, so `dont-touch@2` stays as it is.
-- The client now ends a run when a row leaves the line with a white tile still on
-- it, the same way "End run" ends one: no extra tap, so the submitted taps replay
-- exactly as before. Ending a run early can only lower a score. What changes is
-- the copy the game page shows, which has to describe the run as it now plays.
update public.games
   set instructions = 'Rows rise to a line. Tap every white tile in the row at the line before the row passes, and never touch a black one. A black tap ends the run, and so does a white tile that slips past the line. There is no final row: the conveyor keeps speeding up and every row grows a little blacker, so keep going until you slip or choose to stop. Each white tile scores ten points, and the tiles you cleared are your score.',
       description = 'Rows scroll faster every second. Touch a black tile or let a white one pass and the run ends.'
 where slug = 'dont-touch-the-black'
   and status = 'published';
