-- bbcode_plain (supabase/migrations/0113_search.sql) runs in the index trigger on every post, and an instance's post length has no upper bound, so its cost must grow
-- with the post and not with its square. Each adversarial body is made at n and at 4n repeats and timed: a linear walk takes about four times as long at 4n, a quadratic one
-- sixteen, and the bound between them is 8x. Ratios, not a clock, so a slow machine does not fail it; the floor on the small run keeps timer noise out of a ratio of tiny times.
do $test$
declare
  c record;
  small constant int := 12000;
  t0 timestamp;
  t_small double precision;
  t_big double precision;
  r text;
begin
  for c in
    select * from (values
      ('literal openers',        '[b=1]'),
      ('open and close',         '[b]a[/b]'),
      ('stray closers',          'a[/b]'),
      ('unclosed openers',       '[b]x'),
      ('quotes dropped',         '[quote=00000000-0000-0000-0000-000000000000]words[/quote]'),
      ('items',                  '[list][*]x[/list]'),
      ('links closed',           '[url]x[/url]'),
      ('links, one unclosed',    '[url]a[/url][url]b'),
      ('images',                 '[img]http://a.example/x[/img]'),
      ('links with an address',  '[url]http://a.example/x[/url]'),
      ('links, blanks and brackets', E'[url] \t[ \n[ \u3000[/url]'),
      ('links, one open to the next', E'[url]  [  [  ')
    ) as v (name, unit)
  loop
    t0 := clock_timestamp();
    r := bbcode_plain(repeat(c.unit, small));
    t_small := greatest(extract(epoch from clock_timestamp() - t0), 0.02);
    t0 := clock_timestamp();
    r := bbcode_plain(repeat(c.unit, small * 4));
    t_big := extract(epoch from clock_timestamp() - t0);
    if t_big > t_small * 8 then
      raise exception 'bbcode_plain is not linear on "%": % repeats took % s, % took % s (more than 8x)', c.name, small, round(t_small::numeric, 3), small * 4, round(t_big::numeric, 3);
    end if;
  end loop;
end
$test$;
