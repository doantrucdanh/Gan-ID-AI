
import { MapIDStructure, MapIDItem } from '../types';

export interface ExerciseMatch {
  block: string;
  env: string;
  startIndex: number;
  endIndex: number;
}

export const parseMapID = (content: string): { mapid: MapIDStructure; mucDoMap: Record<string, string> } => {
  const mapid: MapIDStructure = {};
  const mucDoMap: Record<string, string> = {};
  let currentLop: string | null = null;
  let currentMon: string | null = null;
  let currentChuong: string | null = null;
  let currentBai: string | null = null;

  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.trim().startsWith('%') || line.trim().startsWith('\\')) {
      const mucDoMatch = line.match(/\[([NHVC])\]\s+(.+)/);
      if (mucDoMatch) {
        mucDoMap[mucDoMatch[1]] = mucDoMatch[2];
      }
      continue;
    }

    const dashMatch = line.match(/^(\s*)(-+)\[(.+?)\]\s+(.*)/);
    if (!dashMatch) continue;

    const leadingDashes = dashMatch[2].length;
    const code = dashMatch[3].trim();
    const name = dashMatch[4].trim();

    if (leadingDashes === 1) {
      currentLop = code;
      if (!mapid[currentLop]) mapid[currentLop] = {};
      currentMon = currentChuong = currentBai = null;
    } 
    else if (leadingDashes === 4 && currentLop) {
      currentMon = code;
      if (!mapid[currentLop][currentMon]) mapid[currentLop][currentMon] = {};
      currentChuong = currentBai = null;
    }
    else if (leadingDashes === 7 && currentLop && currentMon) {
      currentChuong = code;
      if (!mapid[currentLop][currentMon][currentChuong]) mapid[currentLop][currentMon][currentChuong] = {};
      currentBai = null;
    }
    else if (leadingDashes === 10 && currentLop && currentMon && currentChuong) {
      currentBai = code;
      if (!mapid[currentLop][currentMon][currentChuong][currentBai]) {
        mapid[currentLop][currentMon][currentChuong][currentBai] = {};
      }
    }
    else if (leadingDashes === 13 && currentLop && currentMon && currentChuong && currentBai) {
      mapid[currentLop][currentMon][currentChuong][currentBai][code] = name;
    }
  }

  return { mapid, mucDoMap };
};

export const buildKnowledge = (mapid: MapIDStructure): { data: MapIDItem[]; summary: string } => {
  const data: MapIDItem[] = [];
  const summaryLines: string[] = [];

  Object.entries(mapid).forEach(([lop, mons]) => {
    summaryLines.push(`Lớp ${lop}:`);
    Object.entries(mons).forEach(([mon, chs]) => {
      summaryLines.push(`  - Môn ${mon}:`);
      Object.entries(chs).forEach(([chuong, bais]) => {
        summaryLines.push(`    * Chương ${chuong}:`);
        Object.entries(bais).forEach(([bai, dangs]) => {
          summaryLines.push(`      + Bài ${bai}:`);
          Object.entries(dangs).forEach(([dcode, dname]) => {
            summaryLines.push(`        > Dạng ${dcode}: ${dname}`);
            data.push({
              lop,
              mon,
              chuong,
              bai,
              dang: dcode,
              ten_dang: dname as string,
            });
          });
        });
      });
    });
  });

  return { data, summary: summaryLines.join('\n') };
};

/**
 * Bóc tách câu hỏi và ghi lại vị trí chính xác trong file gốc
 */
export const extractExercisesWithPositions = (content: string): ExerciseMatch[] => {
  const matches: ExerciseMatch[] = [];
  const regex = /\\begin\{(ex|bt|vd)\}([\s\S]*?)\\end\{\1\}/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    matches.push({
      block: m[0],
      env: m[1],
      startIndex: m.index,
      endIndex: regex.lastIndex
    });
  }
  return matches;
};

export const extractExercises = (content: string): string[] => {
  return extractExercisesWithPositions(content).map(m => m.block);
};
