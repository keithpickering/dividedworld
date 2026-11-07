import type { GroupsContent } from '../../engine/rules/groups.ts';

/**
 * Divided World's member groups: the ladder a member climbs by posts and seasons (lowest first, the default is the
 * lowest and staff the highest) and the groups a Boss confers by a move. The names and colors are the owner's, drafted
 * for review.
 */
export const groups: GroupsContent = {
  ladder: [
    { key: 'members', name: 'Members', badge: 'Member', color: '#7a7a7a', when: { kind: 'default' } },
    { key: 'regulars', name: 'Regulars', badge: 'Regular', color: '#2f6fb0', when: { kind: 'posts', atLeast: 100 } },
    { key: 'oldGuard', name: 'Old Guard', badge: 'Old Guard', color: '#9c6b30', when: { kind: 'seasons', atLeast: 2 } },
    { key: 'personalityCores', name: 'Personality Cores', badge: 'Personality Core', color: '#d4a017', when: { kind: 'staff' } },
  ],
  conferred: [
    { key: 'trialMembers', name: 'Trial Members', badge: 'Trial Member', color: '#d2691e', stripe: true, tone: 'punishment' },
    { key: 'teachersPet', name: "Teacher's Pet", badge: "Teacher's Pet", color: '#c2408f', tone: 'favor' },
    { key: 'hallMonitors', name: 'Hall Monitors', badge: 'Hall Monitor', color: '#3f8f5a', tone: 'favor' },
  ],
};
