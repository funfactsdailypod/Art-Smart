#!/usr/bin/env ruby
# frozen_string_literal: true

require 'webrick'
require 'json'
require 'fileutils'
require 'time'
require 'socket'

PORT = (ENV['PORT'] || 8080).to_i
ROOT = File.expand_path('public', __dir__)
DATA_FILE = File.join(ROOT, 'data', 'questions.json')
ROOMS_DIR = File.join(__dir__, '.local_rooms')
FileUtils.mkdir_p(ROOMS_DIR)

ROOM_MUTEX = Mutex.new
POINT_TIERS = [100, 90, 80, 70, 60].freeze
EXPIRY_DURATIONS = {
  '1h' => 3600,
  '1d' => 86_400,
  '1w' => 604_800
}.freeze

def lan_ip_address
  Socket.ip_address_list.find { |addr| addr.ipv4_private? }&.ip_address
rescue StandardError
  nil
end

def load_correct_index_map
  return {} unless File.exist?(DATA_FILE)

  questions = JSON.parse(File.read(DATA_FILE))
  map = {}
  questions.each do |q|
    next unless q.is_a?(Hash) && q['guid']

    map[q['guid'].to_s] = q['correctIndex'].to_i
  end
  map
rescue StandardError => e
  warn "[Art Smart] Could not read questions index map: #{e.message}"
  {}
end

def sanitize_code(raw)
  cleaned = raw.to_s.upcase.gsub(/[^A-Z0-9-]/, '')
  return nil if cleaned.length < 3 || cleaned.length > 24

  cleaned
end

def room_file(code)
  safe = sanitize_code(code)
  return nil unless safe

  File.join(ROOMS_DIR, "#{safe}.json")
end

def room_expired?(room)
  return false unless room && room['expiresAt']

  Time.iso8601(room['expiresAt'].to_s) < Time.now
rescue StandardError
  false
end

def cleanup_expired_rooms
  Dir.glob(File.join(ROOMS_DIR, '*.json')).each do |path|
    begin
      raw = File.read(path)
      room = JSON.parse(raw)
      File.delete(path) if room_expired?(room)
    rescue StandardError
      # Leave unreadable files untouched rather than failing requests
    end
  end
end

def generate_unique_code
  100.times do
    candidate = format('%06d', rand(100_000..999_999))
    path = room_file(candidate)
    return candidate unless path && File.exist?(path)
  end
  format('%06d', (Time.now.to_i % 900_000) + 100_000)
end

def compute_expires_at(expiry_key)
  seconds = EXPIRY_DURATIONS.fetch(expiry_key.to_s, 86_400)
  (Time.now + seconds).utc.iso8601
end

def recalculate_room_scores!(room, correct_map)
  players = room['players']
  return unless players.is_a?(Hash)

  guids = room['questionGuids'] || []
  totals = Hash.new(0)
  correct_counts = Hash.new(0)
  first_counts = Hash.new(0)
  players.each_key do |pid|
    totals[pid] = 0
    correct_counts[pid] = 0
    first_counts[pid] = 0
  end

  # Collect every question index that has been answered by at least one player
  seen_indices = {}
  players.each_value do |pdata|
    next unless pdata.is_a?(Hash) && pdata['answers'].is_a?(Hash)

    pdata['answers'].each_key { |q_key| seen_indices[q_key.to_s] = true }
  end

  seen_indices.each_key do |q_key|
    q_idx = q_key.to_i
    guid = guids[q_idx]
    next unless guid && correct_map.key?(guid.to_s)

    correct_idx = correct_map[guid.to_s]
    correct_entries = []

    players.each do |pid, pdata|
      next unless pdata.is_a?(Hash) && pdata['answers'].is_a?(Hash)

      ans = pdata['answers'][q_key]
      next unless ans.is_a?(Hash)

      if ans['choice'].to_i == correct_idx
        correct_entries << [pid, ans]
      else
        ans['points'] = 0
        ans['correct'] = false
        ans['rank'] = nil
      end
    end

    correct_entries.sort_by! do |pid, ans|
      [
        (ans['serverSeq'] || 9_999_999_999).to_i,
        (ans['answeredAtMs'] || 9_999_999_999_999).to_i,
        pid.to_s
      ]
    end

    correct_entries.each_with_index do |(pid, ans), rank_idx|
      pts = rank_idx < POINT_TIERS.length ? POINT_TIERS[rank_idx] : 50
      ans['points'] = pts
      ans['correct'] = true
      ans['rank'] = rank_idx + 1
      totals[pid] += pts
      correct_counts[pid] += 1
      first_counts[pid] += 1 if rank_idx.zero?
    end
  end

  players.each do |pid, pdata|
    next unless pdata.is_a?(Hash)

    pdata['score'] = totals[pid]
    pdata['correctCount'] = correct_counts[pid]
    pdata['firstCount'] = first_counts[pid]
  end
end

def next_server_seq(room)
  seq = (room['answerSeq'] || 0).to_i + 1
  room['answerSeq'] = seq
  seq
end

def json_response(res, status, payload)
  res.status = status
  res['Content-Type'] = 'application/json; charset=utf-8'
  res['Cache-Control'] = 'no-store'
  res.body = JSON.generate(payload)
end

server = WEBrick::HTTPServer.new(
  Port: PORT,
  DocumentRoot: ROOT,
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)

server.mount_proc '/api/health' do |_req, res|
  correct_map = load_correct_index_map
  json_response(res, 200, {
    ok: true,
    app: 'Art Smart Trivia Studio',
    mode: 'local-ruby',
    questionCount: correct_map.size,
    lanIp: lan_ip_address,
    port: PORT
  })
end

def handle_rooms_request(req, res)
  res['Access-Control-Allow-Origin'] = '*'
  res['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
  res['Access-Control-Allow-Headers'] = 'Content-Type'

  if req.request_method == 'OPTIONS'
    res.status = 204
    return
  end

  path_parts = req.path.sub(%r{^/api/rooms/?}, '').split('/').reject(&:empty?)
  code_param = sanitize_code(path_parts[0])
  correct_map = load_correct_index_map

  ROOM_MUTEX.synchronize do
    cleanup_expired_rooms

    case req.request_method
    when 'GET'
      if code_param
        path = room_file(code_param)
        unless path && File.exist?(path)
          json_response(res, 404, { error: 'Classroom game code not found or expired.' })
          return
        end
        room = JSON.parse(File.read(path))
        if room_expired?(room)
          File.delete(path)
          json_response(res, 410, { error: 'That classroom game code has expired.' })
          return
        end
        recalculate_room_scores!(room, correct_map)
        json_response(res, 200, room)
      else
        list = Dir.glob(File.join(ROOMS_DIR, '*.json')).filter_map do |p|
          r = JSON.parse(File.read(p))
          next if room_expired?(r)

          {
            code: r['code'],
            hostName: r['hostName'],
            status: r['status'],
            expiryKey: r['expiryKey'],
            expiresAt: r['expiresAt'],
            playerCount: (r['players'] || {}).size,
            questionMode: r['questionMode']
          }
        rescue StandardError
          nil
        end
        json_response(res, 200, { rooms: list })
      end

    when 'POST'
      body = JSON.parse(req.body.to_s.empty? ? '{}' : req.body)
      requested_code = sanitize_code(body['code'])
      if body['code'] && !body['code'].to_s.strip.empty? && !requested_code
        json_response(res, 400, { error: 'Custom codes must be 3 to 24 letters or numbers.' })
        return
      end

      code = requested_code || generate_unique_code
      path = room_file(code)
      if requested_code && File.exist?(path)
        existing = JSON.parse(File.read(path))
        unless room_expired?(existing)
          json_response(res, 409, { error: "Code \"#{code}\" is already in use right now." })
          return
        end
      end

      now_iso = Time.now.utc.iso8601
      expiry_key = EXPIRY_DURATIONS.key?(body['expiryKey'].to_s) ? body['expiryKey'].to_s : '1d'
      raw_timer = body.key?('timerSec') ? body['timerSec'].to_i : 25
      timer_sec = raw_timer <= 0 ? 0 : [[raw_timer, 10].max, 120].min

      room = {
        'code' => code,
        'hostId' => body['hostId'].to_s,
        'hostName' => (body['hostName'] || 'Teacher').to_s[0, 32],
        'title' => (body['title'] || 'Art Smart Classroom Game').to_s[0, 64],
        'status' => 'lobby',
        'currentIndex' => 0,
        'questionMode' => body['questionMode'] || 'random',
        'theme' => body['theme'] || 'All',
        'showFilter' => body['showFilter'] || 'All',
        'questionCount' => body['questionCount'].nil? ? 10 : body['questionCount'],
        'isEndless' => !!body['isEndless'],
        'questionGuids' => Array(body['questionGuids']).map(&:to_s),
        'pacing' => timer_sec.zero? ? 'manual' : (body['pacing'] || 'timed'),
        'timerSec' => timer_sec,
        'expiryKey' => expiry_key,
        'createdAt' => now_iso,
        'updatedAt' => now_iso,
        'expiresAt' => compute_expires_at(expiry_key),
        'questionStartedAtMs' => nil,
        'answerSeq' => 0,
        'players' => {}
      }

      File.write(path, JSON.generate(room))
      json_response(res, 201, room)

    when 'PUT'
      unless code_param
        json_response(res, 400, { error: 'Missing room code.' })
        return
      end
      path = room_file(code_param)
      unless path && File.exist?(path)
        json_response(res, 404, { error: 'Classroom game code not found.' })
        return
      end

      room = JSON.parse(File.read(path))
      if room_expired?(room)
        File.delete(path)
        json_response(res, 410, { error: 'Classroom game code has expired.' })
        return
      end

      body = JSON.parse(req.body.to_s.empty? ? '{}' : req.body)
      room['players'] ||= {}
      action = body['action'].to_s

      case action
      when 'join'
        player = body['player'] || {}
        pid = player['id'].to_s
        if pid.empty?
          json_response(res, 400, { error: 'Missing player ID.' })
          return
        end
        existing_p = room['players'][pid] || {}
        room['players'][pid] = {
          'id' => pid,
          'name' => (player['name'] || existing_p['name'] || 'Artist').to_s[0, 24],
          'avatar' => (player['avatar'] || existing_p['avatar'] || 'painter').to_s,
          'joinedAt' => existing_p['joinedAt'] || Time.now.utc.iso8601,
          'score' => existing_p['score'] || 0,
          'correctCount' => existing_p['correctCount'] || 0,
          'firstCount' => existing_p['firstCount'] || 0,
          'answers' => existing_p['answers'] || {}
        }

      when 'answer'
        pid = body['playerId'].to_s
        q_idx = body['qIndex'].to_i
        choice = body['choice'].to_i
        player = room['players'][pid]
        unless player
          json_response(res, 404, { error: 'Player is not joined in this classroom game.' })
          return
        end
        player['answers'] ||= {}
        q_key = q_idx.to_s
        unless player['answers'].key?(q_key)
          player['answers'][q_key] = {
            'choice' => choice,
            'answeredAtMs' => (body['answeredAtMs'] || (Time.now.to_f * 1000).to_i).to_i,
            'serverSeq' => next_server_seq(room),
            'points' => 0,
            'correct' => false,
            'rank' => nil
          }
        end

      when 'hostUpdate'
        patch = body['patch'] || {}
        %w[
          status currentIndex questionStartedAtMs questionGuids
          isEndless questionCount pacing timerSec title showAudioCue
        ].each do |field|
          room[field] = patch[field] if patch.key?(field)
        end

      when 'appendQuestions'
        extra = Array(body['extraGuids']).map(&:to_s).reject(&:empty?)
        existing_guids = Array(room['questionGuids']).map(&:to_s)
        extra.each do |g|
          existing_guids << g unless existing_guids.include?(g)
        end
        room['questionGuids'] = existing_guids
        room['currentIndex'] = body['nextIndex'].to_i if body.key?('nextIndex')
        room['status'] = body['status'] if body['status']
        room['questionStartedAtMs'] = body['questionStartedAtMs'] if body.key?('questionStartedAtMs')

      when 'reset'
        # Preserves room code, expiresAt, and teacher's quiz setup for the next class period
        room['status'] = 'lobby'
        room['currentIndex'] = 0
        room['questionStartedAtMs'] = nil
        room['answerSeq'] = 0
        room['players'] = {}
        room['showAudioCue'] = false
        if body['newQuestionGuids'].is_a?(Array) && !body['newQuestionGuids'].empty?
          room['questionGuids'] = body['newQuestionGuids'].map(&:to_s)
        end

      else
        # Backward-compatible full/partial merge when action is omitted
        if body['players'].is_a?(Hash)
          body['players'].each do |pid, pdata|
            next unless pdata.is_a?(Hash)

            cur = room['players'][pid] || {}
            merged_answers = (cur['answers'] || {}).merge(pdata['answers'] || {})
            merged_answers.each_value do |ans|
              next unless ans.is_a?(Hash) && !ans['serverSeq']

              ans['serverSeq'] = next_server_seq(room)
            end
            room['players'][pid] = cur.merge(pdata).merge('answers' => merged_answers)
          end
        end
        %w[status currentIndex questionStartedAtMs questionGuids pacing timerSec].each do |field|
          room[field] = body[field] if body.key?(field)
        end
      end

      room['updatedAt'] = Time.now.utc.iso8601
      recalculate_room_scores!(room, correct_map)
      File.write(path, JSON.generate(room))
      json_response(res, 200, room)

    when 'DELETE'
      if code_param
        path = room_file(code_param)
        File.delete(path) if path && File.exist?(path)
      end
      json_response(res, 200, { deleted: true, code: code_param })

    else
      json_response(res, 405, { error: 'Method not allowed.' })
    end
  end
end

class RoomsServlet < WEBrick::HTTPServlet::AbstractServlet
  def do_GET(req, res)
    handle_rooms_request(req, res)
  end

  def do_POST(req, res)
    handle_rooms_request(req, res)
  end

  def do_PUT(req, res)
    handle_rooms_request(req, res)
  end

  def do_DELETE(req, res)
    handle_rooms_request(req, res)
  end

  def do_OPTIONS(req, res)
    handle_rooms_request(req, res)
  end
end

server.mount '/api/rooms', RoomsServlet

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

lan = lan_ip_address
puts "============================================================"
puts " Art Smart Trivia Studio running!"
puts " Local URL : http://localhost:#{PORT}"
puts " Wi-Fi URL : http://#{lan}:#{PORT}" if lan
puts "============================================================"
server.start
