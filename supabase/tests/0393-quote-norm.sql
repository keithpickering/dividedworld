-- kayfabb-sql: alone
-- This file holds wall-clock budgets, so it runs with nothing beside it (#1099).
-- quote_norm (0393_forged_quotes.sql) is engine/bbcode/quoted.ts quoteNorm, and linear. The run cap was a backreference regex first, which is quadratic in Postgres (the `[b=1]` x 1600 shape took 1.3 s, 144,000 characters
-- over two minutes); each long shape here would show it. The bound is generous (a slow machine passes) and far under what the quadratic one took at these sizes.
do $test$
declare
  t0 timestamp;
  r text;
  c record;
begin
  if quote_norm(E'  a \n\t b　　c ') is distinct from 'a b c' then raise exception 'quote_norm: whitespace'; end if;
  if quote_norm('n' || repeat('o', 12) || '!') is distinct from 'n' || repeat('o', 8) || '!' then raise exception 'quote_norm: a run of twelve'; end if;
  if quote_norm(repeat('o', 8)) is distinct from repeat('o', 8) then raise exception 'quote_norm: a run of eight stays'; end if;
  if quote_norm(repeat('o', 20000)) is distinct from repeat('o', 8) then raise exception 'quote_norm: a run of 20,000'; end if;
  if quote_norm(repeat(chr(128512), 12)) is distinct from repeat(chr(128512), 8) then raise exception 'quote_norm: a run of one code point outside the BMP'; end if;
  if quote_norm('... a ...') is distinct from 'a' or quote_norm(chr(8230) || 'a' || chr(8230)) is distinct from 'a' or quote_norm('...... x ... y ......') is distinct from 'x ... y' or quote_norm('.. a ..') is distinct from '.. a ..' then raise exception 'quote_norm: ellipses'; end if;
  if quote_norm('cafe' || chr(769)) is distinct from 'caf' || chr(233) then raise exception 'quote_norm: NFC'; end if;
  if quote_norm('') is distinct from '' then raise exception 'quote_norm: empty'; end if;
  -- every member of the whitespace class is one space between two letters (quoteNorm's list in engine/bbcode/quoted.ts; a member dropped from either language goes red)
  for c in select t.cp from unnest(array[9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279] || array(select generate_series(8192, 8202))) as t (cp) loop
    if quote_norm('a' || chr(c.cp) || 'b') is distinct from 'a b' then raise exception 'quote_norm: U+% is not read as whitespace', to_hex(c.cp); end if;
  end loop;
  if quote_norm('a' || chr(8203) || 'b') is distinct from 'a' || chr(8203) || 'b' then raise exception 'quote_norm: a zero width space is not whitespace'; end if;
  for c in
    select * from (values
      ('[b=1] x 4000', repeat('[b=1]', 4000)),
      ('abcdefgh x 16000', repeat('abcdefgh ', 16000)),
      ('one letter x 20000', repeat('a', 20000)),
      ('runs of nine x 4000', repeat('ab' || repeat('c', 9), 4000))
    ) as v (name, body)
  loop
    t0 := clock_timestamp();
    r := quote_norm(c.body);
    if extract(epoch from clock_timestamp() - t0) > 2 then
      raise exception 'quote_norm is not linear on "%": took % s', c.name, round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
    end if;
  end loop;
end
$test$;
