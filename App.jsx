import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState('leaderboard'); // leaderboard, admin, score, beer
  const [password, setPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);
  const [courseData, setCourseData] = useState([]);
  
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedTeamForPlayer, setSelectedTeamForPlayer] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedHole, setSelectedHole] = useState('1');
  const [scoreInput, setScoreInput] = useState('');
  
  const channelRef = useRef(null);

  // Initialize password on first load
  useEffect(() => {
    const storedPassword = localStorage.getItem('tournamentPassword');
    if (!storedPassword) {
      localStorage.setItem('tournamentPassword', 'falcons2025');
    }
    setPassword(storedPassword || 'falcons2025');
  }, []);

  // Real-time subscription
  useEffect(() => {
    if (!authenticated) return;

    const channelName = `changes_${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        fetchTeams();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
        fetchPlayers();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, () => {
        fetchScores();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [authenticated]);

  // Fetch data
  const fetchTeams = async () => {
    const { data } = await supabase.from('teams').select('*');
    setTeams(data || []);
  };

  const fetchPlayers = async () => {
    const { data } = await supabase.from('players').select('*');
    setPlayers(data || []);
  };

  const fetchScores = async () => {
    const { data } = await supabase.from('scores').select('*');
    setScores(data || []);
  };

  const fetchCourseData = async () => {
    const { data } = await supabase.from('course_data').select('*').order('hole');
    setCourseData(data || []);
  };

  // Initial fetch
  useEffect(() => {
    if (authenticated) {
      fetchTeams();
      fetchPlayers();
      fetchScores();
      fetchCourseData();
    }
  }, [authenticated]);

  const handleLogin = () => {
    if (passwordInput === (password || 'falcons2025')) {
      setAuthenticated(true);
      setPasswordInput('');
    } else {
      alert('Invalid password');
    }
  };

  const handleLogout = () => {
    setAuthenticated(false);
    setPasswordInput('');
  };

  // Add team
  const handleAddTeam = async () => {
    if (!newTeamName.trim()) return;
    await supabase.from('teams').insert([{ name: newTeamName }]);
    setNewTeamName('');
    fetchTeams();
  };

  // Add player
  const handleAddPlayer = async () => {
    if (!newPlayerName.trim() || !selectedTeamForPlayer) return;
    await supabase.from('players').insert([
      { name: newPlayerName, team_id: selectedTeamForPlayer }
    ]);
    setNewPlayerName('');
    setSelectedTeamForPlayer('');
    fetchPlayers();
  };

  // Submit score
  const handleSubmitScore = async () => {
    if (!selectedTeam || !selectedHole || !scoreInput) return;
    
    const existingScore = scores.find(s => s.team_id === selectedTeam && s.hole === parseInt(selectedHole));
    
    if (existingScore) {
      await supabase
        .from('scores')
        .update({ strokes: parseInt(scoreInput) })
        .eq('id', existingScore.id);
    } else {
      await supabase.from('scores').insert([
        { team_id: selectedTeam, hole: parseInt(selectedHole), strokes: parseInt(scoreInput) }
      ]);
    }
    
    setScoreInput('');
    fetchScores();
  };

  // Update current hole and total score for team
  const updateTeamMetrics = async () => {
    for (const team of teams) {
      const teamScores = scores.filter(s => s.team_id === team.id);
      const currentHole = Math.max(...teamScores.map(s => s.hole), 0) + 1;
      const totalScore = teamScores.reduce((sum, s) => {
        const course = courseData.find(c => c.hole === s.hole);
        return sum + (s.strokes - (course?.par || 0));
      }, 0);

      await supabase
        .from('teams')
        .update({ current_hole: Math.min(currentHole, 18), total_score: totalScore })
        .eq('id', team.id);
    }
  };

  useEffect(() => {
    if (scores.length > 0 && courseData.length > 0) {
      updateTeamMetrics();
    }
  }, [scores]);

  // Update beer count
  const handleBeerIncrement = async (playerId) => {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    const newBeerCount = (player.beer_count || 0) + 1;
    await supabase
      .from('players')
      .update({ beer_count: newBeerCount })
      .eq('id', playerId);

    const teamBeers = players
      .filter(p => p.team_id === player.team_id)
      .reduce((sum, p) => sum + (p.beer_count || 0), 1);

    await supabase
      .from('teams')
      .update({ total_beers: teamBeers })
      .eq('id', player.team_id);

    fetchPlayers();
  };

  const getLeaderboard = () => {
    return teams
      .map(team => ({
        ...team,
        playerCount: players.filter(p => p.team_id === team.id).length,
        teamPlayers: players.filter(p => p.team_id === team.id)
      }))
      .sort((a, b) => {
        if (a.total_score !== b.total_score) return b.total_score - a.total_score;
        return a.current_hole - b.current_hole;
      });
  };

  if (!authenticated) {
    return (
      <div className="app login-screen">
        <div className="falcon-logo">
          <h1>🏌️</h1>
          <h2>Falcon's Lair Invitational</h2>
          <p>22nd Annual</p>
        </div>
        <div className="login-box">
          <input
            type="password"
            placeholder="Tournament Password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
          />
          <button onClick={handleLogin}>Enter</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🏌️ Falcon's Lair</h1>
        <div className="nav-buttons">
          <button className={view === 'leaderboard' ? 'active' : ''} onClick={() => setView('leaderboard')}>
            Leaderboard
          </button>
          <button className={view === 'score' ? 'active' : ''} onClick={() => setView('score')}>
            Enter Score
          </button>
          <button className={view === 'beer' ? 'active' : ''} onClick={() => setView('beer')}>
            Beers
          </button>
          <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
            Admin
          </button>
          <button onClick={handleLogout} className="logout">Logout</button>
        </div>
      </header>

      <main className="app-content">
        {/* LEADERBOARD VIEW */}
        {view === 'leaderboard' && (
          <section className="leaderboard">
            <h2>Live Leaderboard</h2>
            <div className="scoreboard">
              {getLeaderboard().map((team, rank) => (
                <div key={team.id} className="team-card">
                  <div className="team-header">
                    <div className="rank-badge">{rank + 1}</div>
                    <div className="team-info">
                      <h3>{team.name}</h3>
                      <p className="players-count">{team.playerCount} Players</p>
                    </div>
                  </div>
                  <div className="team-stats">
                    <div className="stat">
                      <span className="label">Score</span>
                      <span className="value">{team.total_score >= 0 ? '+' : ''}{team.total_score}</span>
                    </div>
                    <div className="stat">
                      <span className="label">Hole</span>
                      <span className="value">{team.current_hole}</span>
                    </div>
                    <div className="stat">
                      <span className="label">Beers</span>
                      <span className="value">{team.total_beers || 0}</span>
                    </div>
                  </div>
                  <div className="team-players">
                    {team.teamPlayers.map(player => (
                      <span key={player.id} className="player-tag">
                        {player.name} 🍺{player.beer_count || 0}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* SCORE ENTRY VIEW */}
        {view === 'score' && (
          <section className="score-entry">
            <h2>Enter Team Score</h2>
            <div className="form-group">
              <label>Select Team</label>
              <select value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
                <option value="">-- Choose Team --</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Hole</label>
              <select value={selectedHole} onChange={(e) => setSelectedHole(e.target.value)}>
                {Array.from({length: 18}, (_, i) => i + 1).map(hole => (
                  <option key={hole} value={hole}>Hole {hole}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Strokes</label>
              <input
                type="number"
                value={scoreInput}
                onChange={(e) => setScoreInput(e.target.value)}
                placeholder="Enter score"
              />
            </div>
            <button onClick={handleSubmitScore} className="submit-btn">Submit Score</button>

            {selectedTeam && (
              <div className="score-history">
                <h3>Team Scores</h3>
                <div className="holes-grid">
                  {Array.from({length: 18}, (_, i) => i + 1).map(hole => {
                    const score = scores.find(s => s.team_id === selectedTeam && s.hole === hole);
                    const par = courseData.find(c => c.hole === hole)?.par || 0;
                    return (
                      <div key={hole} className={`hole-score ${score ? 'filled' : ''}`}>
                        <div className="hole-num">{hole}</div>
                        <div className="par">Par {par}</div>
                        {score && <div className="score">{score.strokes}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* BEER TRACKER VIEW */}
        {view === 'beer' && (
          <section className="beer-tracker">
            <h2>🍺 Beer Tracker</h2>
            <div className="beer-grid">
              {teams.map(team => (
                <div key={team.id} className="beer-team">
                  <h3>{team.name}</h3>
                  <div className="team-total">Total: {team.total_beers || 0}</div>
                  <div className="players-list">
                    {players
                      .filter(p => p.team_id === team.id)
                      .map(player => (
                        <div key={player.id} className="beer-player">
                          <span>{player.name}</span>
                          <div className="beer-controls">
                            <span className="beer-count">{player.beer_count || 0}</span>
                            <button onClick={() => handleBeerIncrement(player.id)}>+</button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ADMIN VIEW */}
        {view === 'admin' && (
          <section className="admin-panel">
            <div className="admin-column">
              <h2>Create Team</h2>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Team Name"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                />
                <button onClick={handleAddTeam}>Add Team</button>
              </div>
              <div className="teams-list">
                <h3>Teams ({teams.length})</h3>
                {teams.map(team => (
                  <div key={team.id} className="team-item">{team.name}</div>
                ))}
              </div>
            </div>

            <div className="admin-column">
              <h2>Add Player</h2>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Player Name"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                />
                <select value={selectedTeamForPlayer} onChange={(e) => setSelectedTeamForPlayer(e.target.value)}>
                  <option value="">-- Assign to Team --</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
                <button onClick={handleAddPlayer}>Add Player</button>
              </div>
              <div className="players-list">
                <h3>Players ({players.length})</h3>
                {teams.map(team => (
                  <div key={team.id} className="team-group">
                    <h4>{team.name}</h4>
                    {players
                      .filter(p => p.team_id === team.id)
                      .map(player => (
                        <div key={player.id} className="player-item">{player.name}</div>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
