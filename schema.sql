-- ===========================================================================
--  Orbit — schema MySQL / MariaDB
--  A importer dans phpMyAdmin (onglet "Importer" ou "SQL") dans la base "orbit".
--  (Facultatif : le serveur cree aussi ces tables tout seul au 1er demarrage
--   si l'utilisateur MySQL a le privilege CREATE.)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pseudo VARCHAR(24) NOT NULL,
  pseudo_key VARCHAR(24) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  password_hash VARCHAR(128) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  last_login_at DATETIME NULL,
  UNIQUE KEY uq_users_pseudo (pseudo_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maps (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_maps_owner (owner_id),
  CONSTRAINT fk_maps_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS map_members (
  map_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL,
  PRIMARY KEY (map_id, user_id),
  KEY idx_members_user (user_id),
  CONSTRAINT fk_members_map FOREIGN KEY (map_id) REFERENCES maps (id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invitations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  inviter_id INT UNSIGNED NOT NULL,
  invitee_id INT UNSIGNED NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL,
  responded_at DATETIME NULL,
  KEY idx_inv_invitee (invitee_id, status),
  KEY idx_inv_map (map_id, status),
  CONSTRAINT fk_inv_map FOREIGN KEY (map_id) REFERENCES maps (id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_inviter FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_invitee FOREIGN KEY (invitee_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS folders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  title VARCHAR(60) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  x DOUBLE NOT NULL DEFAULT 0,
  y DOUBLE NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_folders_map (map_id),
  CONSTRAINT fk_folders_map FOREIGN KEY (map_id) REFERENCES maps (id) ON DELETE CASCADE,
  CONSTRAINT fk_folders_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  folder_id INT UNSIGNED NOT NULL,
  title VARCHAR(140) NOT NULL,
  description TEXT NULL,
  assignee_id INT UNSIGNED NULL,
  done TINYINT(1) NOT NULL DEFAULT 0,
  position DOUBLE NOT NULL DEFAULT 0,
  due_date DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  done_at DATETIME NULL,
  KEY idx_tasks_folder (folder_id),
  KEY idx_tasks_assignee (assignee_id),
  CONSTRAINT fk_tasks_folder FOREIGN KEY (folder_id) REFERENCES folders (id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Toile des besoins : besoins, elements a mettre en place, contraintes
CREATE TABLE IF NOT EXISTS nodes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  parent_id INT UNSIGNED NULL,
  kind VARCHAR(12) NOT NULL DEFAULT 'besoin',
  title VARCHAR(120) NOT NULL,
  description TEXT NULL,
  assignee_id INT UNSIGNED NULL,
  done TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_nodes_map (map_id),
  KEY idx_nodes_parent (parent_id),
  CONSTRAINT fk_nodes_map FOREIGN KEY (map_id) REFERENCES maps (id) ON DELETE CASCADE,
  CONSTRAINT fk_nodes_parent FOREIGN KEY (parent_id) REFERENCES nodes (id) ON DELETE CASCADE,
  CONSTRAINT fk_nodes_assignee FOREIGN KEY (assignee_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_nodes_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Liens transverses entre deux noeuds (un meme element peut servir plusieurs besoins)
CREATE TABLE IF NOT EXISTS node_links (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  source_id INT UNSIGNED NOT NULL,
  target_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_links (source_id, target_id),
  KEY idx_links_map (map_id),
  CONSTRAINT fk_links_map FOREIGN KEY (map_id) REFERENCES maps (id) ON DELETE CASCADE,
  CONSTRAINT fk_links_source FOREIGN KEY (source_id) REFERENCES nodes (id) ON DELETE CASCADE,
  CONSTRAINT fk_links_target FOREIGN KEY (target_id) REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
