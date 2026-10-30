import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getResearcherResults, type ResearcherParticipantResult } from './researcher.service';

interface ResearcherDataState {
  participants: ResearcherParticipantResult[];
  loading: boolean;
  error: string;
  retry: () => void;
}

const ResearcherDataContext = createContext<ResearcherDataState | null>(null);

export function ResearcherDataProvider({ children }: { children: ReactNode }) {
  const [participants, setParticipants] = useState<ResearcherParticipantResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    void getResearcherResults()
      .then((results) => active && setParticipants(results))
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : 'Unable to load researcher results.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [version]);
  const retry = useCallback(() => {
    setLoading(true);
    setError('');
    setVersion((value) => value + 1);
  }, []);
  return <ResearcherDataContext.Provider value={{ participants, loading, error, retry }}>{children}</ResearcherDataContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useResearcherData(): ResearcherDataState {
  const value = useContext(ResearcherDataContext);
  if (!value) throw new Error('Researcher data must be used within ResearcherDataProvider.');
  return value;
}
