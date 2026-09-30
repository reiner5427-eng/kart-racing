export type Mode = 'speed' | 'item';

export type RecordEntry = {
  id: string;
  playerName: string;
  characterId: string;
  characterName: string;
  bestLapTime: number;
  totalTime: number;
  mode: Mode;
  date: string;
  lapTimes: [number, number, number];
};

const CHARACTERS: Record<string, string> = {
  pikachu: '피카츄',
  eevee: '이브이',
  charmander: '파이리',
  bulbasaur: '이상해씨',
  pidgeotto: '피죤',
  snorlax: '잠만보',
};

export const MAX_ENTRIES = 10;
const MIN_LAP_MS = 12_000;
const MAX_LAP_MS = 30 * 60_000;

export function validateRecord(input: unknown): RecordEntry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('기록 형식이 올바르지 않습니다.');
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id)) throw new Error('기록 ID가 올바르지 않습니다.');
  if (typeof value.playerName !== 'string') throw new Error('이름이 올바르지 않습니다.');
  const playerName = value.playerName.trim();
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9 ]{1,12}$/.test(playerName)) throw new Error('이름은 한글·영문·숫자 12자 이하여야 합니다.');
  if (typeof value.characterId !== 'string' || !Object.hasOwn(CHARACTERS, value.characterId)) throw new Error('캐릭터가 올바르지 않습니다.');
  if (value.mode !== 'speed' && value.mode !== 'item') throw new Error('게임 모드가 올바르지 않습니다.');
  if (!Array.isArray(value.lapTimes) || value.lapTimes.length !== 3 ||
      !value.lapTimes.every((time: unknown) => typeof time === 'number' && Number.isFinite(time) && time >= MIN_LAP_MS && time <= MAX_LAP_MS)) {
    throw new Error('3개의 정상 랩타임이 필요합니다.');
  }
  const lapTimes = value.lapTimes.map((time: number) => Math.round(time)) as [number, number, number];
  const bestLapTime = Math.min(...lapTimes);
  const totalTime = lapTimes.reduce((sum, time) => sum + time, 0);
  if (typeof value.bestLapTime !== 'number' || !Number.isFinite(value.bestLapTime) || Math.abs(value.bestLapTime - bestLapTime) > 2) throw new Error('BEST LAP과 랩타임이 일치하지 않습니다.');
  if (typeof value.totalTime !== 'number' || !Number.isFinite(value.totalTime) || Math.abs(value.totalTime - totalTime) > 5) throw new Error('총 시간과 랩타임이 일치하지 않습니다.');
  return {
    id: value.id,
    playerName,
    characterId: value.characterId,
    characterName: CHARACTERS[value.characterId],
    bestLapTime,
    totalTime,
    mode: value.mode,
    date: new Date().toISOString(),
    lapTimes,
  };
}

export function rankRecords(records: RecordEntry[]): RecordEntry[] {
  return records.sort((a, b) => a.bestLapTime - b.bestLapTime || a.totalTime - b.totalTime || a.date.localeCompare(b.date));
}
