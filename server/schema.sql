-- CREATE DATABASE IF NOT EXISTS exam_portal;
-- USE exam_portal;
CREATE TABLE users(
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), email VARCHAR(100) UNIQUE,
  password VARCHAR(255), role ENUM('student','admin') DEFAULT 'student');
CREATE TABLE exams(
  id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(150), duration_min INT);
CREATE TABLE questions(
  id INT AUTO_INCREMENT PRIMARY KEY, exam_id INT, text TEXT,
  a VARCHAR(255), b VARCHAR(255), c VARCHAR(255), d VARCHAR(255),
  correct CHAR(1), FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE);
CREATE TABLE attempts(
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, exam_id INT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP, submitted_at DATETIME NULL,
  score INT DEFAULT 0, total INT DEFAULT 0, violations INT DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(exam_id) REFERENCES exams(id));
INSERT INTO exams(title,duration_min) VALUES('Sample: Basic CS Quiz',5);
INSERT INTO questions(exam_id,text,a,b,c,d,correct) VALUES
(1,'Which data structure uses LIFO?','Queue','Stack','Tree','Graph','b'),
(1,'Time complexity of binary search?','O(n)','O(n^2)','O(log n)','O(1)','c'),
(1,'SQL command to remove a table?','DELETE','REMOVE','DROP','CLEAR','c');
