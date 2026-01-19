
export interface MapIDItem {
  lop: string;
  mon: string;
  chuong: string;
  bai: string;
  dang: string;
  ten_dang: string;
}

export interface MapIDStructure {
  [lop: string]: {
    [mon: string]: {
      [chuong: string]: {
        [bai: string]: {
          [dang: string]: string;
        };
      };
    };
  };
}

export interface AIResult {
  lop: string;
  mon: string;
  chuong: string;
  bai: string;
  dang: string;
  muc_do: 'N' | 'H' | 'V' | 'C';
  do_tin_cay: number;
  is_valid?: boolean;
}

export interface QuestionProcessResult {
  index: number;
  questionPreview: string;
  idCode: string;
  status: 'valid' | 'warning' | 'error';
  confidence: string;
  level: string;
  fullBlock: string;
  errorMessage?: string;
}

export interface ProcessingState {
  isProcessing: boolean;
  current: number;
  total: number;
  results: QuestionProcessResult[];
}
