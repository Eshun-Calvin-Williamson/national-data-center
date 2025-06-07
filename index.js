import express, { query } from 'express'
import bodyParser from 'body-parser';
import path from 'path'
import { dirname } from 'path';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
// import  axois from 'axois';
import { fileURLToPath } from 'url';
import pg from 'pg';
import multer from 'multer';
// to download database 
import { Parser } from 'json2csv';
// to download in excel format
import ExcelJS from 'exceljs';
import session from 'express-session';
import dotenv from 'dotenv';
dotenv.config()
  

import { name } from 'ejs';
import bcrypt from 'bcrypt'




// connect database
const db= new pg.Client(
  {
    user:process.env.DB_USER,
    localhost: process.env.DB_HOST,
    database: "ndc ",
    password: process.env.DB_PASSWORD,
    port: process.env.BD_PORT,
  }
)

const __dirname =dirname(fileURLToPath(import.meta.url));
const app =express();
const port = 3300;
var validUSer =false;

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({extended: true}));
import methodOverride from 'method-override';
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, "public")));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret:process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {secure:false}
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);  
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });


db.connect((err)=>{
  if(err){
    console.log(`failed to connect to database`,err)
  }else{
    console.log(`connected to database successfully`)
  }
});


async function logActivity(user, action, details = '') {
  try {
    await db.query(
      `INSERT INTO activity_logs (user_id, user_email, action, details)
       VALUES ($1, $2, $3, $4)`,
      [user?.id || 'guest', user?.email || 'unknown', action, details]
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}


const passcode =async (req,res,next)=>{
  const {id,password,email} =req.body;


try {
    const results =await db.query(`SELECT id, user_name, email, image, password,role FROM users WHERE email = $1`,[email])
    const users =results.rows[0];
    
    if(users){
      if(password === users.password){
        req.session.user =users;
        req.users =users;
        validUSer =true;
        await logActivity(users, 'Login', 'User logged in successfully');
      }else{
        validUSer =false
      }
    }
    else{
      validUSer =false;
      await logActivity(null, 'Failed Login', `Attempted login for ${email}`);
    }
    if(!validUSer){
      return res.redirect('/?error=Login failed, please check your credentials');
    }
    next();
} catch (err) {
  console.error(`Error checking credentials`)
  res.status(500).send('Error Checking credentials')
}
};


function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/');
}



const requireAdmin =(req, res, next)=> {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  } else {
    return res.status(403).send('Access denied: ADMINS ONLY.');
  }
}



app.get('/logout', async (req,res)=>{
  if (req.session.user) await logActivity(req.session.user, 'Logout', 'User logged out');
  req.session.destroy(err =>{
    if(err){
      return res.status(500).send('Could not log out')
    }
    
  })
  res.redirect('/?success=You have been logged out successfully');
  })


app.get('/', (req, res) => {
  const success = req.query.success || null;
  const error = req.query.error || null;

  res.render('home', { success, error });
});



app.get('/user',isAuthenticated ,(req,res)=>{
if(req.session.user?.role !== 'admin'){
  return res.status(403).send('Access denied')
}
  res.render('user.ejs',{ user: req.session.user})
})

app.get('/add', isAuthenticated, (req,res)=>{
  res.render('add.ejs')
})

// app.get('/manage-data',(req,res)=>{
//   res.render('manage-data.ejs')
// })

// app.get('/activities', isAuthenticated, (req,res)=>{
//   res.render('activities.ejs')
// })

app.get('/activities', isAuthenticated, requireAdmin, async (req, res) => {
  try {
    const logs = await db.query('SELECT * FROM activity_logs ORDER BY timestamp DESC');
    res.render('activities.ejs', { logs: logs.rows });
  } catch (err) {
    console.error('Error fetching activity logs:', err);
    res.status(500).send('Error fetching logs');
  }
});


// app.get('/dashboard',(req,res)=>{
//   res.render('dashboard.ejs')
// })

// map route 
app.get('/map',(req,res)=>{
  res.render('map')
})


// password authentication
app.get('/submit',isAuthenticated, (req,res)=>{
  res.render('dashbaord.ejs')
})

app.post('/submit',passcode, isAuthenticated, async (req,res)=>{
  try {
    const userResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE email = $1', ['active']);
    const nssResults = await db.query('SELECT COUNT(*) AS count FROM users');
    const staffResults = await db.query('SELECT COUNT(*) AS count FROM users' );
    const totalResults = await db.query('SELECT COUNT(*) AS count FROM users');



    const usersResults = await db.query('SELECT id, email, image, user_name FROM users ');
    const metrics = {
      activeMembers: userResults.rows[0].count,
      nssPersonnel: nssResults.rows[0].count,
      staffMembers: staffResults.rows[0].count,
      totalMembers: totalResults.rows[0].count,
    };

    await logActivity(req.session.user, 'View Dashboard', 'User accessed dashboard');

    res.render('dashboard.ejs',{ metrics, users: req.users})

  } catch (err) {
    console.error('Error fetching data for dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }

  if(validUSer){
  }else{
    res.send('wrong message :: Check logins')
  }
})


app.post('/add',upload.single('photo'), isAuthenticated, async (req,res)=>{
  // const hashedPassword = await bcrypt.hash(password, 10);
  const {id,password,email,name,role} =req.body;
  const image = req.file ? `/uploads/${req.file.filename}`: null;

  try {
    await db.query(`INSERT INTO users (id,password,email,image,user_name,role)
       VALUES
       ($1,$2,$3,$4,$5,$6)`
       ,[id,password,email,image,name,role]);

       await logActivity(req.session.user, 'Create User', `User ${email} added`);

       res.redirect('/?success=User added successfully');
      } catch (err) {
    console.error('Error inserting data',err);
    res.status(500).send('error saving data');
  }
})

// event handling
// app.post('/events', async (req,res)=>{
//   const {
//     id,
//     day,
//     // Hour,
//     minute,
//     second,
//     latitude,
//     longitude,
//     H,
//     Mb,
//     Ml,
//     Az,
//     location,
//     nearest_location} =req.body;

//     if (
//       day === null || minute === null ||
//       second === null || latitude === null || longitude === null ||
//       H === null || Mb === null || Ml === null || Az === null ||
//       location === null || nearest_location === null
//     ) {
//       return res.status(400).send('All fields must be filled out.'); 
//     }

//   try {
//     await db.query(`INSERT INTO data 
//       (id,day,minute,second,latitude,longitude,h,mb,ml,az,location,nearest_location) VALUES ON CONFLICT (id) DO UPDATE  SET(
//         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[
//           id,
//           day,
//           minute,
//           second,
//           latitude,
//           longitude,
//           H,
//           Mb,
//           Ml,
//           Az,
//           location,
//           nearest_location
//         ]);
//         res.redirect('/add')
//   } catch (err) {
//     console.error('Error inserting data',err);
//     // console.status(500).send('Error saving data')
//   }
// });



app.post('/events', async (req, res) => {
  const {
    id,
    day,
    minute,
    second,
    latitude,
    longitude,
    H,
    Mb,
    Ml,
    Az,
    location,
    nearest_location
  } = req.body;

  if (
    !id || !day || !minute || !second ||
    !latitude || !longitude || !H || !Mb ||
    !Ml || !Az || !location || !nearest_location
  ) {
    return res.status(400).send('All fields must be filled out.');
  }

  try {
    await db.query(`
      INSERT INTO data (
        id, day, minute, second, latitude, longitude, h, mb, ml, az, location, nearest_location
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (id) DO UPDATE SET
        day = EXCLUDED.day,
        minute = EXCLUDED.minute,
        second = EXCLUDED.second,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        h = EXCLUDED.h,
        mb = EXCLUDED.mb,
        ml = EXCLUDED.ml,
        az = EXCLUDED.az,
        location = EXCLUDED.location,
        nearest_location = EXCLUDED.nearest_location
    `, [
      id,
      day,
      minute,
      second,
      latitude,
      longitude,
      H,
      Mb,
      Ml,
      Az,
      location,
      nearest_location
    ]);

    await logActivity(req.session.user, 'Add/Update Event', `Event ${id} added or updated`);


    res.redirect('/add');
  } catch (err) {
    console.error('Error inserting or updating event data:', err);
    res.status(500).send('Server error saving event data.');
  }
});



app.get('/manage-data',isAuthenticated, async (req,res)=>{
  try {
    const results =await db.query(`SELECT * FROM data`);
    console.log('Fetched events:', results.rows);
    res.render('manage-data.ejs',{data:results.rows })
  } catch (err) {
    console.error('Error Fetching data',err);
    res.status(500).send(`error in your client`);
  }
})

app.get('/search',async (req,res)=>{
  const {query} =req.query;
  try {
    const results =await db.query(
      `SELECT * FROM data WHERE 
        TO_CHAR(day, 'YYYY-MM-DD') ILIKE $1
        OR CAST(minute AS TEXT) ILIKE $2
        OR CAST(second AS TEXT) ILIKE $3
        OR CAST(latitude AS TEXT) ILIKE $4
        OR CAST(longitude AS TEXT) ILIKE $5
        OR CAST(h AS TEXT) ILIKE $6
        OR CAST(mb AS TEXT) ILIKE $7
        OR CAST(ml AS TEXT) ILIKE $8
        OR CAST(az AS TEXT) ILIKE $9
        OR location ILIKE $10
        OR nearest_location ILIKE $11`,
        [`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`,`%${query}%`]
    )
    res.render("manage-data.ejs",{data:results.rows})
  } catch (err) {
    console.error('Error fetching data',err)
    res.status(500).send('error on user end');
  }
});


app.get('/dashboard',isAuthenticated, async (req, res) => {
  try {
    const userResults = await db.query('SELECT COUNT(*) AS count FROM users WHERE email = $1', ['active']);
    const nssResults = await db.query('SELECT COUNT(*) AS count FROM users');
    const staffResults = await db.query('SELECT COUNT(*) AS count FROM users' );
    const totalResults = await db.query('SELECT COUNT(*) AS count FROM users');

    const metrics = {
      activeMembers: userResults.rows[0].count,
      nssPersonnel: nssResults.rows[0].count,
      staffMembers: staffResults.rows[0].count,
      totalMembers: totalResults.rows[0].count,
    };

    await logActivity(req.session.user, 'Access Dashboard', 'User accessed dashboard');


    const usersResults = await db.query('SELECT id, email, image,user_name FROM users');


    res.render('dashboard.ejs', { metrics, users:usersResults.rows });
  } catch (err) {
    console.error('Error fetching data for dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }
});


// patch handling
// app.patch('/data/:id',async (req,res)=>{
//   const {id} =req.params;
//   const {day,minute,second,latitude,longitude,H,Mb,Ml,Az,location,nearest_location} = req.body;
//   try {
//      await db.query (`UPDATE data SET day=$1, minute=$2, second =$3, latitude=$4 , longitude=$5,  h=$6 ,mb=$7 , ml=$8 , az=$9, location=$10, nearest_location=$11 WHERE id=$12`,[
//       day,
//       minute,
//       second,
//       latitude,
//       longitude,
//       H,
//       Mb,
//       Ml,
//       Az,
//       location,
//       nearest_location,
//       id
//     ])
//     res.json({ success: true, message: 'Data updated successfully' });
//   } catch (err) {
//     console.log(' Error updating data',err);
//     res.status(500).send('Click the patch to update');
//   }
// })




app.delete('/data/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM data WHERE id = $1', [id]);

    await logActivity(req.session.user, 'Delete Event', `Event ${id} deleted`);

    res.redirect('/manage-data?success=Event deleted successfully');
  } catch (err) {
    console.error('Error deleting data:', err);
    res.status(500).send('Error deleting data');
  }
});

// download database into csv format 

app.get('/download', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM data');
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(404).send('No data available to download.');
    }

    const fields = Object.keys(rows[0]); // CSV headers from DB columns
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(rows);

    await logActivity(req.session.user, 'Download CSV', 'User downloaded data in CSV');


    res.header('Content-Type', 'text/csv');
    res.attachment('data_export.csv');
    return res.send(csv);
  } catch (err) {
    console.error('Error exporting data:', err);
    res.status(500).send('Error exporting data');
  }
});

// download database in excel format 
app.get('/download-excel', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM data');
    const rows = result.rows;

    if (rows.length === 0) {
      return res.status(404).send('No data to export.');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Event Data');

    // Add headers from the keys of the first row
    worksheet.columns = Object.keys(rows[0]).map(key => ({
      header: key.toUpperCase(),
      key: key,
      width: 20
    }));

    // Add rows
    rows.forEach(row => {
      worksheet.addRow(row);
    });

    await logActivity(req.session.user, 'Download Excel', 'User downloaded data in Excel');


    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="data_export.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exporting Excel:', err);
    res.status(500).send('Failed to export Excel file');
  }
});


// forget and reset password route

app.get('/forgot-password', (req, res) => {
  const success = req.query.success || null;
  const error = req.query.error || null;
  res.render('forgot-password', { success, error });
});



app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 3600000); // 1 hour

  try {
    // Save token and expiry to DB
    await db.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3',
      [token, expires, email]
    );

    // Send email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'your-email@gmail.com',
        pass: 'ajkg beuj ttbb ulkf'
      }
    });

    const resetLink = `http://localhost:3000/reset-password/${token}`;
    await transporter.sendMail({
      to: email,
      subject: 'Password Reset',
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password. The link expires in 1 hour.</p>`
    });

    res.render('forgot-password', {
      success: 'Check your email for reset instructions.',
      error: null
    });
  } catch (err) {
    console.error(err);
    res.render('forgot-password', {
      error: 'Something went wrong. Please try again.',
      success: null
    });
  }
});




app.listen(port,()=>{
  console.log(`server runing on port ${port}`)
})