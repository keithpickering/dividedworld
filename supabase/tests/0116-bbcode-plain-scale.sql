-- bbcode_plain (supabase/migrations/0112_search.sql, redefined by 0114_bbcode_tags.sql) runs in the index trigger on every post, and an instance's post length has no upper bound, so its cost must grow
-- with the post and not with its square. Each adversarial body is made at n and at 4n repeats (n is the row's own: the tags 0114 added are dearer to a repeat, so theirs is smaller) and timed: a linear walk takes about four times as long at 4n, a quadratic one
-- sixteen, and the bound between them is 8x. Ratios, not a clock, so a slow machine does not fail it; the floor on the small run keeps timer noise out of a ratio of tiny times.
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
      ('literal openers',        '[b=1]', 12000),
      ('open and close',         '[b]a[/b]', 12000),
      ('stray closers',          'a[/b]', 12000),
      ('unclosed openers',       '[b]x', 12000),
      ('quotes dropped',         '[quote=00000000-0000-0000-0000-000000000000]words[/quote]', 12000),
      ('items',                  '[list][*]x[/list]', 12000),
      ('links closed',           '[url]x[/url]', 12000),
      ('links, one unclosed',    '[url]a[/url][url]b', 12000),
      ('images',                 '[img]http://a.example/x[/img]', 12000),
      ('links with an address',  '[url]http://a.example/x[/url]', 12000),
      ('links, blanks and brackets', E'[url] \t[ \n[ \u3000[/url]', 12000),
      ('links, one open to the next', E'[url]  [  [  ', 12000),
      -- The BBCode tags (0114): the raw ones with no closer, with a closer, and many openers in front of one closer; the inline spoiler's blocked tags; the counted frames.
      ('video openers, no closer',        '[video]', 3000),
      ('youtube openers, no closer',      '[youtube]', 3000),
      ('noparse openers, no closer',      '[noparse]', 3000),
      ('videos',                          '[video]https://youtu.be/dQw4w9WgXcQ[/video]', 3000),
      ('videos, refused',                 '[video]https://youtu.be.evil.example/dQw4w9WgXcQ[/video]', 3000),
      ('videos, every provider row',      '[video]https://www.youtube.com/watch?x=1&v=dQw4w9WgXcQ[/video][video]https://a.example/x.mp4[/video][video]https://xn--bcher-kva.example/x.mp4[/video]', 3000),
      ('videos, an openers run to one closer', '[video][video][video][video]https://youtu.be/dQw4w9WgXcQ[/video]', 3000),
      ('youtube ids',                     '[youtube]dQw4w9WgXcQ[/youtube]', 3000),
      ('noparse',                         '[noparse][b]x[/b][/noparse]', 3000),
      ('noparse, an openers run to one closer', '[noparse][noparse][noparse]x[/noparse]', 3000),
      ('noparse in a bare link',          '[url][noparse]http://a.example/x[/noparse][/url]', 3000),
      ('inline spoilers, closed',         '[ispoiler]x[/ispoiler]', 3000),
      ('inline spoilers, unclosed',       '[ispoiler]x', 3000),
      ('inline spoilers, blocked tags',   '[ispoiler][quote=x]a[hr][video]b[/quote][/video][url=http://a.example/x]', 3000),
      ('counterfeit quotes',              '[quote=x user=00000000-0000-0000-0000-000000000000]a[/quote]', 3000),
      ('spoilers and layout tags',        '[spoiler=t][center][font=Impact][glow=red]a[/glow][/font][/center][/spoiler]', 3000),
      ('rules',                           'a[hr]b[/hr]', 3000)
    ) as v (name, unit, small)
  loop
    t0 := clock_timestamp();
    r := bbcode_plain(repeat(c.unit, c.small));
    t_small := greatest(extract(epoch from clock_timestamp() - t0), 0.02);
    t0 := clock_timestamp();
    r := bbcode_plain(repeat(c.unit, c.small * 4));
    t_big := extract(epoch from clock_timestamp() - t0);
    if t_big > t_small * 8 then
      raise exception 'bbcode_plain is not linear on "%": % repeats took % s, % took % s (more than 8x)', c.name, c.small, round(t_small::numeric, 3), c.small * 4, round(t_big::numeric, 3);
    end if;
  end loop;
end
$test$;
