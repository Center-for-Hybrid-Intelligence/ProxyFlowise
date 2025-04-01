const express = require('express');
const multer = require('multer');
const app = express();
const fs = require('fs');
const tar = require('tar-fs');
const cors = require('cors');
const Docker = require('dockerode');
const path = require('path');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

const upload = multer({ dest: 'uploads/',
			limits: { fileSize: 100 * 1024 * 1024 } });

async function query(payload) {
    const endpoint = payload.endpoint;
    const method = payload.method;
    const data = payload.data;
    const key = payload.key;
    if (method=="POST") {
	const response = await fetch(
		`https://flowise.hybridintelligence.eu/api/v1/${endpoint}`,
        	{
            	method: method,
            	headers: {
                	"Content-Type": "application/json",
			Authorization: `Bearer ${key}`
            	},
            	body: JSON.stringify(data)
        	}
    	);
    	const result = await response.json();
    	return result;
	}
   else {
	const response = await fetch(
                `https://flowise.hybridintelligence.eu/api/v1/${endpoint}`,
                {
                method: method,
                headers: {
                        Authorization: `Bearer ${key}`
                },
                }
        );
        const result = await response.json();
        return result;
   }
}

app.post('/', async (req, res) => {
    const headers = req.headers;
    const body = req.body;
    const payload = {
			"endpoint":headers.endpoint,
			"method":body.method,
			"data":body.data,
			"key":headers.authorization,
		}
    const response = await query(payload);
    res.send(response);
});

app.post('/upload', upload.single('files'), async (req, res) => {
  const containerId = 'c43d9c49816f';            // <- your container ID or name
  const containerPath = '/root/.flowise/storage/' + req.body.id; // Path inside container where you want the file
  const container = docker.getContainer(containerId);

  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }
    await ensureDirectoryExists(container, containerPath);
    const tmpFolder = path.join(__dirname, 'uploads', `tmp-${Date.now()}`);
    fs.mkdirSync(tmpFolder);

    const fileDestPath = path.join(tmpFolder, req.file.originalname);
    fs.renameSync(req.file.path, fileDestPath);

    const tarStream = tar.pack(tmpFolder);

    await container.putArchive(tarStream, { path: containerPath });

    fs.rmSync(tmpFolder, { recursive: true, force: true });

    res.send('File successfully copied into container!');
  } catch (error) {
    console.error('Error uploading file to container:', error);

    try {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch {}

    res.status(500).send('Error copying file into container.');
  }
});

const PORT = 3666;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});


async function ensureDirectoryExists(container, dir) {
  // Single shell command string: forcibly remove, then recreate the directory
  const command = ['sh', '-c', `rm -rf "${dir}" && mkdir -p "${dir}"`];

  // Create an exec instance, attaching stdout + stderr
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true
  });

  // Start the exec call
  const stream = await exec.start({ hijack: true, stdin: false });

  // Demux the output so Dockerode does NOT parse it as JSON
  container.modem.demuxStream(stream, process.stdout, process.stderr);

  // Wait for the command to complete
  await new Promise((resolve, reject) => {
    container.modem.followProgress(stream, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Check the command's exit code
  const info = await exec.inspect();
  if (info.ExitCode !== 0) {
    throw new Error(
      `ensureDirectoryExists failed with exit code ${info.ExitCode}`
    );
  }
}

app.post('/delete', upload.single('files'), async (req, res) => {
  const containerId = 'c43d9c49816f';            // <- your container ID or name
  const containerPath = '/root/.flowise/storage/' + req.body.id; // Path inside container where you want the file
  const container = docker.getContainer(containerId);
  const command = ['sh', '-c', `rm -rf "${containerPath}"`];

  // Create an exec instance, attaching stdout + stderr
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true
  });

  // Start the exec call
  const stream = await exec.start({ hijack: true, stdin: false });

  // Demux the output so Dockerode does NOT parse it as JSON
  container.modem.demuxStream(stream, process.stdout, process.stderr);

  // Wait for the command to complete
  await new Promise((resolve, reject) => {
    container.modem.followProgress(stream, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Check the command's exit code
  const info = await exec.inspect();
  if (info.ExitCode !== 0) {
    res.json({ success: false, message:`rm -rf failed with exit code ${info.ExitCode}`});
  }
  else {
    res.json({ success: true, message: 'Directory deleted successfully.' });
  }

});
