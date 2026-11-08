-- phrase_norm (supabase/migrations/0144_quote_conditions.sql) runs on the quoting post's whole text for every back that post could spring (phrase_probe), and a post's length has no upper bound, so its
-- cost must grow with the text and not with its square, whatever the text is made of. The runs of characters that are not letters or digits are where a pattern can rescan: a run with no line
-- break, one with a break at its end, and one that alternates. Each body is made at n and at 4n units and timed: a linear walk takes about four times as long at 4n, a quadratic one sixteen, and the bound
-- between them is 8x (0118-bbcode-plain-scale.sql's). Ratios, not a clock; the floor on the small run keeps timer noise out of a ratio of tiny times. The result is also held to a text whose answer is known.
do $test$
declare
  c record;
  t0 timestamp;
  t_small double precision;
  t_big double precision;
  r text;
begin
  for c in
    select * from (values
      ('a run of punctuation, then a word',   'a', '.', ' b', 20000),
      ('a run of spaces, then a word',        'a', ' ', 'a', 20000),
      ('a run of punctuation and spaces',     'a', '. ', 'b', 20000),
      ('a run ending in a line break',        'a', '.', E'\n' || 'b', 20000),
      ('a run opening with a line break',     'a' || E'\n', '.', 'b', 20000),
      ('a run alternating breaks and blanks', 'a', E'\n ', 'b', 20000),
      ('a run of breaks',                     'a', E'\n', 'b', 20000),
      ('a run of non-breaking spaces',        'a', E' ', 'b', 20000),
      ('a run of punctuation at the start',   '', '.', 'a', 20000),
      ('a run of punctuation at the end',     'a', '.', '', 20000)
    ) as v (name, head, unit, tail, small)
  loop
    t0 := clock_timestamp();
    r := phrase_norm(c.head || repeat(c.unit, c.small) || c.tail);
    t_small := greatest(extract(epoch from clock_timestamp() - t0), 0.02);
    t0 := clock_timestamp();
    r := phrase_norm(c.head || repeat(c.unit, c.small * 4) || c.tail);
    t_big := extract(epoch from clock_timestamp() - t0);
    if t_big > t_small * 8 then
      raise exception 'phrase_norm is not linear on "%": % repeats took % s, % took % s (more than 8x)', c.name, c.small, round(t_small::numeric, 3), c.small * 4, round(t_big::numeric, 3);
    end if;
  end loop;
  -- The answer, not only the time: a long run is the same one character (or none) as a short one.
  if phrase_norm('a' || repeat('.', 50000) || ' b') <> 'a b' then raise exception 'a long run of punctuation and a space should be one space'; end if;
  if phrase_norm('a' || repeat('.', 50000) || 'b') <> 'ab' then raise exception 'a long run of punctuation between letters should be removed'; end if;
  if phrase_norm('a' || repeat(' ', 50000) || 'b') <> 'a b' then raise exception 'a long run of spaces should be one space'; end if;
  if phrase_norm('a' || repeat('. ', 50000) || E'\n.b') <> E'a\nb' then raise exception 'a long run holding a line break should be one line break'; end if;
  if phrase_norm(repeat(' ', 50000) || 'a' || repeat(E' \n', 50000)) <> 'a' then raise exception 'the ends should be trimmed'; end if;
end
$test$;
