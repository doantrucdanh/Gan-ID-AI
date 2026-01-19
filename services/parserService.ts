
import { MapIDStructure, MapIDItem } from '../types';

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

    const dashMatch = line.match(/^(\s*)-+\[(.+?)\]\s+(.+)/);
    if (!dashMatch) continue;

    const fullMatch = dashMatch[0];
    const dashCount = fullMatch.indexOf('[') - (fullMatch.length - fullMatch.trimStart().length);
    const code = dashMatch[2].trim();
    const name = dashMatch[3].trim();

    if (dashCount === 1) {
      currentLop = code;
      if (!mapid[currentLop]) mapid[currentLop] = {};
      currentMon = currentChuong = currentBai = null;
    } 
    else if (dashCount === 4 && currentLop) {
      currentMon = code;
      if (!mapid[currentLop][currentMon]) mapid[currentLop][currentMon] = {};
      currentChuong = currentBai = null;
    }
    else if (dashCount === 7 && currentLop && currentMon) {
      currentChuong = code;
      if (!mapid[currentLop][currentMon][currentChuong]) mapid[currentLop][currentMon][currentChuong] = {};
      currentBai = null;
    }
    else if (dashCount === 10 && currentLop && currentMon && currentChuong) {
      currentBai = code;
      if (!mapid[currentLop][currentMon][currentChuong][currentBai]) {
        mapid[currentLop][currentMon][currentChuong][currentBai] = {};
      }
    }
    else if (dashCount === 13 && currentLop && currentMon && currentChuong && currentBai) {
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
          summaryLines.push(`      + Bài ${bai}: ${Object.keys(dangs).length} dạng`);
          Object.entries(dangs).forEach(([dcode, dname]) => {
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

export const extractExercises = (content: string): string[] => {
  // Regex hỗ trợ ex, bt, và vd
  const regex = /\\begin\{(ex|bt|vd)\}([\s\S]*?)\\end\{\1\}/g;
  const matches = content.match(regex);
  return matches || [];
};
