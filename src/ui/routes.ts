export const appRoutes = ['today', 'reader', 'progress', 'groups'] as const;
export const initialRoute = '/(tabs)/today' as const;
import { fixtureProfile } from './fixtureProfile';
import { canonicalSeptemberPlan, getReadingDay } from '../domain/calendar';

export type UiContentState = 'C_PENDING_ACCESS' | 'C_TECHNICAL_PROBE' | 'C_READY' | 'C_NOT_AVAILABLE';

export interface FixtureModels {
  today: {
    date: string;
    references: string[];
    completionStatus: 'COMPLETED' | 'UNREPORTED';
    contentStatus: UiContentState;
    points: number;
    pointsStatus: 'UNCONFIGURED';
    sharedGoal: { completed: number; target: number; personal: number };
  };
  reader: {
    mode: 'pending' | 'c-probe' | 'c-native' | 'b-external';
    references: string[];
    content: { status: UiContentState; message: string };
  };
  progress: {
    points: number;
    pointsStatus: 'UNCONFIGURED';
    members: Array<{ id: string; label: string; isSelf: boolean; status: 'COMPLETED' | 'UNREPORTED' }>;
    sharedGoal: { completed: number; target: number; personal: number };
  };
  groups: {
    groupName: string;
    openChatUrl: string | null;
    rpgUrl: string | null;
    callUrl: string | null;
    callProvider: 'meet' | null;
    callScope: 'TEST_ONLY' | null;
    linkStatus: 'PENDING_UI_VERIFICATION' | 'READY';
  };
}

export function buildFixtureModels(date = '2026-09-08'): FixtureModels {
  const day = getReadingDay(canonicalSeptemberPlan, date);
  const references = day?.references ?? [];
  const sharedGoal = { completed: 1, target: 2, personal: 1 };
  return {
    today: {
      date,
      references,
      completionStatus: 'COMPLETED',
      contentStatus: 'C_TECHNICAL_PROBE',
      points: 0,
      pointsStatus: 'UNCONFIGURED',
      sharedGoal,
    },
    reader: {
      mode: 'c-probe',
      references,
      content: {
        status: 'C_TECHNICAL_PROBE',
        message: '官方YouVersion文字可供受控探測；中文音訊尚未接入。',
      },
    },
    progress: {
      points: 0,
      pointsStatus: 'UNCONFIGURED',
      members: [
        { id: fixtureProfile.memberId, label: fixtureProfile.displayName, isSelf: true, status: 'COMPLETED' },
        { id: 'fixture:other', label: 'O小O', isSelf: false, status: 'UNREPORTED' },
      ],
      sharedGoal,
    },
    groups: {
      groupName: '測試小組A / G01-RPG1',
      openChatUrl: null,
      rpgUrl: null,
      callUrl: 'https://meet.google.com/nyv-basx-ivu',
      callProvider: 'meet',
      callScope: 'TEST_ONLY',
      linkStatus: 'READY',
    },
  };
}
