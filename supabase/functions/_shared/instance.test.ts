import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseInstance } from './instance.ts';
import { chatterSchema } from '../../../engine/system/chatter.ts';
import type { OfferedCard } from '../../../engine/system/chatter.ts';
import { schemaProblems } from '../../../engine/system/schema.ts';

for (const profile of [undefined, 'playtest']) {
  test(`every card with staffOptions has a schema the provider accepts, alone and with every other on offer (profile ${profile ?? 'none'})`, () => {
    const withOptions = chooseInstance(profile).cards.filter((c) => c.staffOptions);
    assert.ok(withOptions.length > 0, 'the instance offers cards with options');
    const offered: OfferedCard[] = withOptions.map((c) => ({ key: c.key, name: c.name, play: 'cast', options: c.staffOptions! }));
    for (const c of withOptions) {
      assert.deepEqual(schemaProblems(c.staffOptions!.schema), [], `${c.key}: its own schema`);
      assert.deepEqual(schemaProblems(chatterSchema({ askedTitle: true, offered: offered.filter((o) => o.key === c.key) })), [], `${c.key}: in a call`);
    }
    assert.deepEqual(schemaProblems(chatterSchema({ askedTitle: true, offered })), [], 'every one at once');
  });
}
